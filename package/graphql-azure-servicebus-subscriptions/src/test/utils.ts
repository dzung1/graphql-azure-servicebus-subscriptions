import {
  MessageHandlers,
  ServiceBusMessage,
  ServiceBusReceivedMessage,
  SubscribeOptions,
} from "@azure/service-bus";

class FakeMessageSender {
  public messages: ServiceBusMessage[] = [];
  private receiver: FakeMessageReceiver;

  constructor(receiver: FakeMessageReceiver) {
    this.receiver = receiver;
  }

  public sendMessages(message: ServiceBusMessage): Promise<void> {
    this.messages.push(message);
    this.receiver.pendingMessages.push(message);
    return Promise.resolve();
  }
  public messageCount(): number {
    return this.messages.length;
  }
  public lastMessage(): ServiceBusMessage | undefined {
    return this.messages.length > 0
      ? this.messages[this.messages.length - 1]
      : undefined;
  }

  reset(): void {
    this.messages = [];
  }
}

class FakeMessageReceiver {
  public messageHandlers: MessageHandlers | undefined;
  public pendingMessages: ServiceBusMessage[] = [];
  public onClose: Function = () => {};

  subscribe(
    handlers: MessageHandlers,
    options?: SubscribeOptions
  ): {
    /**
     * Causes the subscriber to stop receiving new messages.
     */
    close(): Promise<void>;
  } {
    this.messageHandlers = handlers;
    return {
      close: () => {
        this.onClose();
        return Promise.resolve();
      },
    };
  }

  flush(): Promise<void> {
    for (const index in this.pendingMessages) {
      const message = this.pendingMessages[index];
      const receivedMessage = <ServiceBusReceivedMessage>message;
      this.messageHandlers?.processMessage(receivedMessage);
      this.pendingMessages.splice(<number>(<unknown>index), 1);
    }
    return Promise.resolve();
  }

  reset(): void {
    this.pendingMessages = [];
  }
}

export { FakeMessageSender, FakeMessageReceiver };
