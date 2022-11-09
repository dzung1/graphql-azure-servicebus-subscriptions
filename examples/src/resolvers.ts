import  { ServiceBusPubSub, IServiceBusOptions }  from "@talema/graphql-azure-servicebus-subscriptions";
import dotenv from "dotenv";
import { withFilter } from 'graphql-subscriptions';

dotenv.config();

const options: IServiceBusOptions = {
  connectionString: process.env.SERVICEBUS_CONNECTION_STRING!,
  topicName: process.env.SERVICEBUS_TOPIC!,
  subscriptionNamePrefix: process.env.SERVICEBUS_SUBSCRIPTION_NAME_PREFIX!,
}

export const serviceBusPubSub = new ServiceBusPubSub(options);

export const resolvers = {
  Query: {
    publishTestEvents() {
      serviceBusPubSub.publish("StatusUpdate", {
        id: "1234",
        status: "Ready",
      });
      serviceBusPubSub.publish("StatusUpdate", {
        id: "5678",
        status: "Complete",
      });
      serviceBusPubSub.publish("StatusUpdate", {
        id: "1234",
        status: "Complete",
      });
      return "OK";
    },
  },
  Subscription: {
    status: {
      resolve: (payload: any) => {
        return payload;
      },
      subscribe: withFilter(
        () => serviceBusPubSub.asyncIterator(["StatusUpdate"]),
        (payload, variables) => {
          return (            
            payload.id === variables.id
          );
        },
      ),
    },
  },
};