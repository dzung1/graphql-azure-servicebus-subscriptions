import {
  ProcessErrorArgs,
  ServiceBusClient,
  ServiceBusMessage,
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
  ServiceBusSender,
} from "@azure/service-bus";
import { PubSubEngine } from "graphql-subscriptions";
import { METHODS } from "http";

/**
 * Internal type for storing relationship between fired event and subscribed client handler.
 */
type SubscriptionInfo = {
  onMessage: (message: ServiceBusReceivedMessage) => void;
  eventName: string;
};

/**
 * Represents configuration needed to wire up PubSub engine with the ServiceBus topic
 * @property {string} connectionString - The ServiceBus connection string. This would be the Shared Access Policy connection string.
 * @property {string} topicName - This would be the topic where all the events will be published.
 * @property {string} subscriptionName - This would be the ServiceBus topic subscription name.
 * @property {boolean} filterEnabled - This would be used to enable a channeling concept for the connected clients, so they would receive only the events they've asked to subscribe to.
 *                                     All the published events will be pushed to the same configured topic, This means all clients would be receive all the events unless this field set as false.
 *                                     To enable message channeling when the message get published, the ServiceBusPubSub would applicationAttribute called eventName, this would be the eventName from the publish method.
 */
export interface IServiceBusOptions {
  connectionString: string;
  topicName: string;
  subscriptionName: string;
  filterEnabled: boolean;
  messageLabelKeyName: string;
}

/**
 * An override for the in-memory PubSubEngine which connects to the Azure ServiceBus.
 */

export class ServiceBusPubSub extends PubSubEngine {
  private client: ServiceBusClient;
  private handlerMap = new Map<number, SubscriptionInfo>();
  private senderMap = new Map<string, ServiceBusSender>();
  private receiverMap = new Map<string, ServiceBusReceiver>();
  private closeHandlerMap = new Map<number, { close(): Promise<void> }>();
  private options: IServiceBusOptions;
  private eventNameKey: string = "sub.eventName";

  constructor(options: IServiceBusOptions, client?: ServiceBusClient) {
    super();
    this.options = options;
    this.client = client || new ServiceBusClient(this.options.connectionString);
    this.eventNameKey = this.options.messageLabelKeyName || this.eventNameKey;
  }

  /**
   * Publish update message to the Azure ServiceBus topic. The publish method would create ServiceBusSender to publish events to the configured topic.
   * The wrap the passed payload in a  ServiceBusMessage or it can accept ServiceBusMessage.
   * The publish method would enrich final ServiceBusMessage with extra attribute subs.eventName,
   * it would have the value of the eventName published. This attribute would be used to filter events sent to the connected clients.
   * @property {string} eventName - the event name that backend GraphQL API would publish. This field would be attached to the published ServiceBusMessage
   * @property {T | ServiceBusMessage} payload - the event payload it could be any type or ServiceBusMessage
   * @property {attributes | Map<string, any>} - the extra attributes client can send part of the final published ServiceBusMessage
   */
  public publish<T>(
    eventName: string,
    payload: T,
    attributes?: Map<string, any>
  ): Promise<void>;
  public publish(
    eventName: string,
    payload: ServiceBusMessage,
    attributes?: Map<string, any>
  ): Promise<void>;
  publish(
    eventName: string,
    payload: any,
    attributes?: Map<string, any>
  ): Promise<void> {
    const sender =
      this.senderMap.get(eventName) ||
      this.client.createSender(this.options.topicName);

    this.senderMap.set(eventName, sender);

    if (this.isServiceBusMessage(payload)) {
      const message = <ServiceBusMessage>payload;

      if (message.applicationProperties == undefined) {
        message.applicationProperties = { [this.eventNameKey]: eventName };
      } else {
        this.enrichMessage(
          new Map<string, any>([[this.eventNameKey, eventName]]),
          message
        );
      }
      return sender.sendMessages(message);
    }

    const internalMassage: ServiceBusMessage = {
      body: payload,
      applicationProperties: { [this.eventNameKey]: eventName },
    };
    return sender.sendMessages(internalMassage);
  }

  private enrichMessage(
    attributes: Map<string, any>,
    message: ServiceBusMessage
  ) {
    if (message.applicationProperties == undefined)
      message.applicationProperties = {};

    attributes.forEach((value, key) => {
      if (
        message.applicationProperties !== undefined &&
        message.applicationProperties?.[key] === undefined
      ) {
        message.applicationProperties[key] = value;
      }
    });
  }

  /**
   * Subscribe to a specific event updates. The subscribe method would create a ServiceBusReceiver to listen to all the published events.
   * The method internally would filter out all the received events that are not meant for this subscriber.
   * @property {eventName | string} - published event name
   * @property {onMessage | Function} - client handler for processing received events.
   * @returns {Promise<number>} - returns the created identifier for the created subscription. It would be used to dispose/close any resources while unsubscribing.
   */
  subscribe(eventName: string, onMessage: Function): Promise<number> {
    const receiver =
      this.receiverMap.get(eventName) ||
      this.client.createReceiver(
        this.options.topicName,
        this.options.subscriptionName
      );

    this.receiverMap.set(eventName, receiver);

    const processMessage = async (message: ServiceBusReceivedMessage) => {
      const receivedMessageEventName =
        message.applicationProperties?.[this.eventNameKey];

      console.log(
        `message.body: ${message.body}, eventName: ${receivedMessageEventName}`
      );
      if (this.options.filterEnabled) {
        if (receivedMessageEventName === eventName) {
          onMessage(message.body);
          return;
        }
        console.log(
          `message ignored due to the filtration based on the eventName: ${eventName}`
        );
      } else {
        onMessage(message.body);
      }
    };

    const processError = async (args: ProcessErrorArgs) => {
      console.log(
        `Error occurred with ${args.entityPath} within ${args.fullyQualifiedNamespace}:`,
        args.error
      );
    };

    const closePromise = receiver.subscribe({
      processMessage: processMessage,
      processError: processError,
    });
    const id = Date.now() * Math.random();

    this.handlerMap.set(id, {
      onMessage: processMessage,
      eventName: eventName,
    });
    this.closeHandlerMap.set(id, closePromise);

    return Promise.resolve(id);
  }

  /**
   * Unsubscribe method would close open connection with the ServiceBus for a specific event handler.
   * @property {subId} - It's a unique identifier for each subscribed client.
   */
  async unsubscribe(subId: number) {
    const info = this.handlerMap.get(subId) || undefined;
    if (info === undefined) return;
    await this.closeHandlerMap.get(subId)?.close();
    this.handlerMap.delete(subId);
  }

  private isServiceBusMessage(payload: any): payload is ServiceBusMessage {
    return (payload as ServiceBusMessage).body !== undefined;
  }

  private isIServiceBusOptions(payload: any): payload is IServiceBusOptions {
    return (payload as IServiceBusOptions).subscriptionName !== undefined;
  }
}
