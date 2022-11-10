import { PubSubEngine } from 'graphql-subscriptions';

import {
  ServiceBusClient,
  ServiceBusAdministrationClient,
  CreateSubscriptionOptions,
  ServiceBusReceivedMessage,
  ServiceBusSender,
  delay,
  isServiceBusError,
} from '@azure/service-bus';

import { Subject, Subscription, filter, tap, map } from 'rxjs';

export interface IEvent {
  /**
   * The message body that needs to be sent or is received.
   */
  body: any;
  /**
   * The application specific properties.
   */
  applicationProperties?: {
    [key: string]: number | boolean | string | Date | null;
  };
}

export interface IEventResult extends ServiceBusReceivedMessage, IEvent {
  body: any;
}

/**
 * Represents configuration needed to wire up PubSub engine with the ServiceBus topic
 * @property {string} connectionString - The ServiceBus connection string. This would be the Shared Access Policy connection string.
 * @property {string} topicName - This would be the topic where all the events will be published.
 * @property {string} subscriptionName - This would be the ServiceBus topic subscription name.
 * @property {string} eventNameKey - Name of the field from the ServiceBus payload to use for top level filtering.
 * @property {string} createSubscription - Control whether to create the ServiceBus subscription if it does not already exist.
 */
export interface IServiceBusOptions {
  connectionString: string;
  topicName: string;
  subscriptionName: string;
  eventNameKey?: string;
  createSubscription: boolean;
  createSubscriptionOptions: IServiceBusSubscriptionOptions | undefined;
}

/**
 * Represents options for a new ServiceBus subscription
 * @property {string} autoDeleteOnIdle - Max idle time before the subscription is deleted.
 * @property {number} maxDeliveryCount - The maximum delivery count of messages after which if it is still not settled, gets moved to the dead-letter sub-queue.
 * @property {string} defaultMessageTimeToLive - Determines how long a message lives in the subscription.
 */
export interface IServiceBusSubscriptionOptions {
  autoDeleteOnIdle: string;
  maxDeliveryCount: number;
  defaultMessageTimeToLive: string;
}

/**
 * An override for the in-memory PubSubEngine which connects to the Azure ServiceBus.
 */

export class ServiceBusPubSub extends PubSubEngine {

  private client: ServiceBusClient;
  private adminClient: ServiceBusAdministrationClient;
  private sender: ServiceBusSender;
  private subscriptions = new Map<number, Subscription>();
  private options: IServiceBusOptions;
  private subject: Subject<IEventResult>;
  private eventNameKey: string = "eventName";

  constructor(options: IServiceBusOptions, client?: ServiceBusClient, adminClient?: ServiceBusAdministrationClient) {
    super();    
    this.options = options;
    this.eventNameKey = this.options.eventNameKey || this.eventNameKey;
    this.client = client || new ServiceBusClient(this.options.connectionString);
    this.adminClient = adminClient || new ServiceBusAdministrationClient(this.options.connectionString);
    this.subject = new Subject<IEventResult>();  
    this.sender = this.client.createSender(this.options.topicName);  

    // TODO: Perhaps the consumer of this pubsub should be reponsible for calling initialize?
    (async () => {
      await this.initialize()
    })();
  }

  public async initialize() {
    // Create a new service bus subscription to be consumed by the current instance of the app
    // Once the app no longer listen to the subscription (app shutdown/scaled down/crash/etc),
    // the subscription will be automatically deleted after the time specified in 'autoDeleteOnIdle'
    if (this.options.createSubscription && this.options.createSubscriptionOptions) {
      try {
        const subscriptionOptions: CreateSubscriptionOptions = {
          autoDeleteOnIdle: this.options.createSubscriptionOptions.autoDeleteOnIdle,
          maxDeliveryCount: this.options.createSubscriptionOptions.maxDeliveryCount,
          defaultMessageTimeToLive: this.options.createSubscriptionOptions.defaultMessageTimeToLive,
        };
        await this.adminClient.createSubscription(
          this.options.topicName,
          this.options.subscriptionName,
          this.options.createSubscriptionOptions,
        );
      } catch (err: any) {
        if (err.name === 'RestError' && err.statusCode == 409 && err.code === 'MessageEntityAlreadyExistsError') {
          // Service bus subscription already exist, can safely continue
          console.log(err.message);
        } else {
          throw err;
        }
      }
    }

    const subscription = this.client
      .createReceiver(this.options.topicName, this.options.subscriptionName)
      .subscribe({
        processMessage: async (message: ServiceBusReceivedMessage) => {
          this.subject.next({
            ...message,
          });
        },
        processError: async (args) => {
          console.log(
            `Error from source ${args.errorSource} occurred: `,
            args.error
          );

          if (isServiceBusError(args.error)) {
            switch (args.error.code) {
              case 'MessagingEntityDisabled':
              case 'MessagingEntityNotFound':
              case 'UnauthorizedAccess':
                console.log(
                  `An unrecoverable error occurred. Stopping processing. ${args.error.code}`,
                  args.error
                );
                await subscription.close();
                break;
              case 'MessageLockLost':
                console.log(`Message lock lost for message`, args.error);
                break;
              case 'ServiceBusy':
                await delay(1000);
                break;
            }
          }
        },
      });
  }
  
  async publish(eventName: string, payload: any): Promise<void> {
    try {
      let event: IEvent = {
        body: {
          ...payload
        },
      };
      event.body[this.eventNameKey] = eventName;
      this.sender.sendMessages([event]);
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Subscribe to a specific event updates. The subscribe method add a new rjxs subscriptions,
   * which will then be evaluated every time a event is received from the service bus.
   * The method internally would filter out all the received events that are not meant for this subscriber.
   * @property {eventName | string} - published event name
   * @property {onMessage | Function} - client handler for processing received events.
   * @returns {Promise<number>} - returns the created identifier for the created subscription. It would be used to dispose/close any resources while unsubscribing.
   */
  async subscribe(eventName: string, onMessage: Function): Promise<number> {
    const id = Date.now() * Math.random();
    this.subscriptions.set(
      id,
      this.subject
        .pipe(
          filter(
            event =>
              (eventName && event.body[this.eventNameKey] === eventName) ||
              !eventName ||
              eventName === '*'
          ),
          map(event => event.body),
        )
        .subscribe(event => onMessage(event))
    );
    return id;
  }

  /**
   * Unsubscribe method would stop this gpl subscription from being evaluate further.
   * The service bus lister will keep running to receive events to be evaluated by other existing gpl subscriptions.
   * @property {subId} - It's a unique identifier for each subscribed client.
   */
  async unsubscribe(subId: number) {
    const subscription = this.subscriptions.get(subId) || undefined;
    if (subscription === undefined) return;
    subscription.unsubscribe();
    this.subscriptions.delete(subId);
  }
}
