
### How to run the example
```
cd example
npm run build
npm run start
```

The above will will host GraphQL endpoint in nodejs express server under port 4000.

### Configuration
The application is reading below config values from the .env file

```
SERVICEBUS_CONNECTION_STRING
SERVICEBUS_TOPIC
SERVICEBUS_SUBSCRIPTION_NAME
GRAPHQL_PORT
```

