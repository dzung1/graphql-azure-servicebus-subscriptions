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
 */
export interface IServiceBusOptions {
  connectionString: string;
  topicName: string;
  subscriptionNamePrefix: string;
  eventNameKey?: string;
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
    (async () => {
      await this.initalize()
    })();
  }

  private async initalize() {
    // Create a new service bus subscription to be consumed by the current instance of the app
    // Once the app no longer listen to the subscription (app shutdown/scaled down/crash/etc),
    // the subscription will be automatically deleted as specified in 'autoDeleteOnIdle'
    const subscriptionName = `${this.options.subscriptionNamePrefix}-${process.env.COMPUTERNAME}`;
    // const sub = await this.adminClient.getSubscription(this.options.topicName, subscriptionName);
    // console.log(sub);
    const subscriptionOptions: CreateSubscriptionOptions = {
      autoDeleteOnIdle: 'PT5M',
      maxDeliveryCount: 10,
      defaultMessageTimeToLive: 'PT5M',
    };
    try {
      await this.adminClient.createSubscription(this.options.topicName, subscriptionName, subscriptionOptions);
    } catch (err: any) {
      if (err.name === 'RestError' && err.statusCode == 409 && err.code === 'MessageEntityAlreadyExistsError') {
        // Service bus subscription already exist, can safely continue
        console.log(err.message);
      } else {
        throw err;
      }
    }    

    const subscription = this.client
      .createReceiver(this.options.topicName, subscriptionName)
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
   * Subscribe to a specific event updates. The subscribe method would create a ServiceBusReceiver to listen to all the published events.
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
            (e) =>
              (eventName && e.body[this.eventNameKey] === eventName) ||
              !eventName ||
              eventName === '*'
          ),
          map((e) => e.body),
          tap((e) => e)
        )
        .subscribe((event) => onMessage(event))
    );
    return id;
  }

  /**
   * Unsubscribe method would close open connection with the ServiceBus for a specific event handler.
   * @property {subId} - It's a unique identifier for each subscribed client.
   */
  async unsubscribe(subId: number) {
    const subscription = this.subscriptions.get(subId) || undefined;
    if (subscription === undefined) return;
    subscription.unsubscribe();
    this.subscriptions.delete(subId);
  }
}
