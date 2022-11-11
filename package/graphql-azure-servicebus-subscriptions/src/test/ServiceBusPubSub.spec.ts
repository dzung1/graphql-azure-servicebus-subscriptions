// tslint:disable-next-line:no-empty

import * as sinon from "sinon";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinonChai from "sinon-chai";
import { IServiceBusOptions, ServiceBusPubSub } from "../ServiceBusPubSub";
import Simple, { spy, mock, Stub } from "simple-mock";
import {
  ServiceBusAdministrationClient,
  ServiceBusClient,
  ServiceBusMessage,
  ServiceBusReceiver,
  ServiceBusSender,
} from "@azure/service-bus";
import { FakeMessageSender, FakeMessageReceiver } from "./utils";
import { lstat } from "fs";
import { afterEach } from "mocha";

chai.use(chaiAsPromised);
chai.use(sinonChai);

const expect = chai.expect;
const assert = chai.assert;
const options: IServiceBusOptions = {
  connectionString: "",
  topicName: "topic",
  subscriptionName: "subs-name",
  eventNameKey: "key",
  useCustomPropertyForEventName: true,
  createSubscription: false,
};

const fakeReceiver = new FakeMessageReceiver();
const fakeSender = new FakeMessageSender(fakeReceiver);
const data: { message: any; eventName: string } = {
  eventName: "somethingChange",
  message: "Hello",
};

function getMockedServiceBusClient(
  senderSpy: any,
  fakeReceiver: any
): {
  client: ServiceBusClient;
  receiverMock: Stub<ServiceBusReceiver>;
  senderMock: Stub<ServiceBusSender>;
} {
  const client = new ServiceBusClient(
    "Endpoint=sb://a;SharedAccessKeyName=b;SharedAccessKey=c;"
  );

  const senderMock = Simple.mock<ServiceBusClient>(
    client,
    "createSender"
  ).returnWith(senderSpy);

  const receiverMock = Simple.mock<ServiceBusClient>(
    client,
    "createReceiver"
  ).returnWith(fakeReceiver);

  return { client, senderMock, receiverMock };
}

function getMockedServiceBusAdminClient(
  senderSpy: any,
  fakeReceiver: any
): {
  client: ServiceBusAdministrationClient;
  receiverMock: Stub<ServiceBusReceiver>;
  senderMock: Stub<ServiceBusSender>;
} {
  const client = new ServiceBusAdministrationClient(
    "Endpoint=sb://a;SharedAccessKeyName=b;SharedAccessKey=c;"
  );

  const senderMock = Simple.mock<ServiceBusClient>(
    client,
    "createSender"
  ).returnWith(senderSpy);

  const receiverMock = Simple.mock<ServiceBusClient>(
    client,
    "createReceiver"
  ).returnWith(fakeReceiver);

  return { client, senderMock, receiverMock };
}

describe("ServiceBusPubSub", () => {
  beforeEach("Reset state", () => {
    fakeReceiver.reset();
    fakeSender.reset();
  });

  it("can subscribe and is called when events happen", async () => {
    const ps = new ServiceBusPubSub(
      options,
      getMockedServiceBusClient(fakeSender, fakeReceiver).client,
      getMockedServiceBusAdminClient(fakeSender, fakeReceiver).client,
    );

    let subscribeCalled = false;
    let receivedMessage = undefined;

    await ps.subscribe(data.eventName, async (payload: any) => {
      subscribeCalled = true;
      receivedMessage = payload;
    });

    await ps.publish(data.eventName, data.message);
    expect(fakeReceiver.pendingMessages.length).to.equal(1);

    await fakeReceiver.flush();
    expect(subscribeCalled).to.be.true;
    expect(receivedMessage).to.equal(data.message);
  });

  it("Can ignore events not specified in the subscription", async () => {
    const ps = new ServiceBusPubSub(
      options,
      getMockedServiceBusClient(fakeSender, fakeReceiver).client,
      getMockedServiceBusAdminClient(fakeSender, fakeReceiver).client,
    );

    let subscribeCalled = false;
    let receivedMessage = undefined;

    await ps.subscribe("unknownEvent", async (payload: any) => {
      subscribeCalled = true;
      receivedMessage = payload;
    });

    await ps.publish(data.eventName, data.message);
    await fakeReceiver.flush();

    expect(subscribeCalled).to.be.false;
    expect(receivedMessage).to.equal(undefined);
  });

  it("will add eventName as an attribute to the ServiceBusMessage published", async () => {
    const ps = new ServiceBusPubSub(
      options,
      getMockedServiceBusClient(fakeSender, fakeReceiver).client,
      getMockedServiceBusAdminClient(fakeSender, fakeReceiver).client,
    );

    await ps.subscribe(data.eventName, (payload: any) => {});
    await ps.publish(data.eventName, data.message);
    const values: Array<any> = [];

    for (const key in fakeReceiver.pendingMessages[0].applicationProperties) {
      values.push(fakeReceiver.pendingMessages[0].applicationProperties[key]);
    }
    expect(values).to.have.members([data.eventName]);
  });

  it("will subscribe once to the save event", async () => {
    const mocked = getMockedServiceBusClient(fakeSender, fakeReceiver);
    const ps = new ServiceBusPubSub(
      options,
      mocked.client,
      getMockedServiceBusAdminClient(fakeSender, fakeReceiver).client,
    );

    await ps.subscribe(data.eventName, (payload: any) => {});
    await ps.subscribe(data.eventName, (payload: any) => {});

    expect(mocked.receiverMock.callCount).to.eq(1);
  });

  it("will create publisher for the eventName once", async () => {
    const mocked = getMockedServiceBusClient(fakeSender, fakeReceiver);
    const ps = new ServiceBusPubSub(
      options,
      mocked.client,
      getMockedServiceBusAdminClient(fakeSender, fakeReceiver).client,
    );

    await ps.publish(data.eventName, data.message);
    await ps.publish(data.eventName, data.message);

    expect(mocked.senderMock.callCount).to.eq(1);
  });

  it("can subscribe to all messages if eventName is *", async () => {
    const mocked = getMockedServiceBusClient(fakeSender, fakeReceiver);
    const ps = new ServiceBusPubSub(
      options,
      mocked.client,
      getMockedServiceBusAdminClient(fakeSender, fakeReceiver).client,
    );

    let subscribeCalled = false;
    let receivedMessage = undefined;

    await ps.subscribe("*", (_: any) => {
      subscribeCalled = true;
      receivedMessage = _;
    });

    await ps.publish(data.eventName, data.message);

    await fakeReceiver.flush();
    expect(subscribeCalled).to.be.true;
    expect(receivedMessage).to.equal(data.message);
  });

  it("will not override message label used for channeling received events to the right client", async () => {
    const mocked = getMockedServiceBusClient(fakeSender, fakeReceiver);
    options.eventNameKey = "label";
    const ps = new ServiceBusPubSub(
      options,
      mocked.client,
      getMockedServiceBusAdminClient(fakeSender, fakeReceiver).client,
    );
    const message: ServiceBusMessage = {
      body: "test message",
      applicationProperties: {
        [options.eventNameKey]: "1233",
      },
    };

    await ps.publish(data.eventName, message);
    const publishedMessage = fakeSender.lastMessage();
    expect(publishedMessage?.applicationProperties).to.equal(
      message?.applicationProperties
    );
  });

  it("will enrich the published ServiceBusMessage with the label", async () => {
    const mocked = getMockedServiceBusClient(fakeSender, fakeReceiver);
    options.eventNameKey = "label";
    const ps = new ServiceBusPubSub(
      options,
      mocked.client,
      getMockedServiceBusAdminClient(fakeSender, fakeReceiver).client,
    );
    const message: ServiceBusMessage = {
      body: "test message",
      applicationProperties: {},
    };

    await ps.publish(data.eventName, message);
    const publishedMessage = fakeSender.lastMessage();
    expect(publishedMessage?.applicationProperties).to.deep.equal({
      label: data.eventName,
    });
  });

  it("can unsubscribe if passed the right client identifier", async () => {
    const mocked = getMockedServiceBusClient(fakeSender, fakeReceiver);
    options.eventNameKey = "label";
    const ps = new ServiceBusPubSub(
      options,
      mocked.client,
      getMockedServiceBusAdminClient(fakeSender, fakeReceiver).client,
    );
    const clientId = await ps.subscribe("a", (_: any) => {});
    let clientClosed: boolean = false;

    fakeReceiver.onClose = () => {
      clientClosed = true;
    };
    await ps.unsubscribe(clientId);

    // TODO: Unsubscribing will not cause the ServiceBus client to close
    // Need to update this unit test case to check whether the appropriate rxjs subscription is removed
    expect(clientClosed).to.be.false;
  });

  it("will skip unsubscribe for unknown client identifiers", async () => {
    const mocked = getMockedServiceBusClient(fakeSender, fakeReceiver);
    options.eventNameKey = "label";
    const ps = new ServiceBusPubSub(
      options,
      mocked.client,
      getMockedServiceBusAdminClient(fakeSender, fakeReceiver).client,
    );
    await ps.subscribe("a", (_: any) => {});
    let clientClosed: boolean = false;

    fakeReceiver.onClose = () => {
      clientClosed = true;
    };
    await ps.unsubscribe(55);
    expect(clientClosed).to.be.false;
  });
});
