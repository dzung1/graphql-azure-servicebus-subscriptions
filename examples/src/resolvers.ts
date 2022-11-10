import  { ServiceBusPubSub, IServiceBusOptions }  from "@talema/graphql-azure-servicebus-subscriptions";
import dotenv from "dotenv";
import { withFilter, ResolverFn } from 'graphql-subscriptions';

dotenv.config();

const options: IServiceBusOptions = {
  connectionString: process.env.SERVICEBUS_CONNECTION_STRING!,
  topicName: process.env.SERVICEBUS_TOPIC!,
  subscriptionName: `${process.env.SERVICEBUS_SUBSCRIPTION_NAME!}-${process.env.HOSTNAME || process.env.COMPUTERNAME}`,
  createSubscription: true,
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
        // Without this, it will return `payload.status`, instead of the actual payload object        
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