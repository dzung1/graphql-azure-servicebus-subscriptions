import  { ServiceBusPubSub, IServiceBusOptions }  from "@talema/graphql-azure-servicebus-subscriptions";
import dotenv from "dotenv";

dotenv.config();

const options: IServiceBusOptions = {
  connectionString: process.env.SERVICEBUS_CONNECTION_STRING!,
  topicName: process.env.SERVICEBUS_TOPIC!,
  subscriptionName: process.env.SERVICEBUS_SUBSCRIPTION_NAME!,
  filterEnabled: true,
}

export const  serviceBusPubSub = new ServiceBusPubSub(options);

export const resolvers = {
  Query: {
    hello() {
        serviceBusPubSub.publish("ConfigUpdate1", {configChanged: {Update: "Hello I'm a message" }});
        serviceBusPubSub.publish("ConfigUpdate2", {configChanged: {Update: "Hello I'm a message2"}}
      );
      return "Some message";
    },
  },
  Subscription: {
    configChanged: {
      subscribe: () => serviceBusPubSub.asyncIterator(["ConfigUpdate2", "ConfigUpdate1"])
    }
  },
};