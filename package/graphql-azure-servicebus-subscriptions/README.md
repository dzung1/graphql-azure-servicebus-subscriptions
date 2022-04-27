# GraphQL Azure Service Bus Subscription Library

This package implements the PubSubEngine Interface from the [graphql-subscriptions](https://github.com/apollographql/graphql-subscriptions) package. 
It allows you to connect your subscriptions manger to a Azure ServiceBus mechanism to support 
multiple subscription manager instances.

## Installation

`npm install @talema/graphql-azure-servicebus-subscriptions`



## Usage


### Initializing the Azure ServiceBus pubsub client
```js
import  { ServiceBusPubSub, IServiceBusOptions }  from "@talema/graphql-azure-servicebus-subscriptions";

const options: IServiceBusOptions = {
  connectionString: process.env.SERVICEBUS_CONNECTION_STRING!,
  topicName: process.env.SERVICEBUS_TOPIC!,
  subscriptionName: process.env.SERVICEBUS_SUBSCRIPTION_NAME!,
  triggerFilterEnabled: true,
}

export const pubsub = new ServiceBusPubSub(options);
```

### Publishing message to the subscription - Azure Topic
```
nameChanged  = {
  firstName: "Abdo",
  lastName: "Talema"
}

Or 

nameChanged : ServiceBusMessage {
  body: {
    firstName: "Abdo",
    lastName: "Talema"
  }
}

pubsub.publish("nameChangedEvent", payload);
```

### Subscribing to the configured topic events - filtered by event name

_Payload would be the published plain message object_

```
const onMessage = (payload) => {
  console.log(message);
}

const subscription = await pubsub.subscribe('nameChanged', onMessage);
```

## Note
The current version of the `ServiceBusPubSub` works with the Competing Consumer pattern. This means if there are (n) of the GraphQL server running theses instances will be competing on consuming notifications updates. 

The new version to support publishing notification updates to all the GraphQL instances will be coming soon. 
 

## Contributing

Contributions are welcome. Make sure to check the existing issues (including the closed ones) before requesting a feature, reporting a bug or opening a pull requests.

For sending a PR follow:

1. Fork it (https://github.com/abdomohamed/graphql-azure-servicebus-subscriptions)
2. Create your feature branch (`git checkout -b my-new-feature`)
3. Commit your changes (`git commit -am 'Add some feature'`)
4. Push to the branch (`git push origin my-new-feature`)
5. Create a new Pull Request


