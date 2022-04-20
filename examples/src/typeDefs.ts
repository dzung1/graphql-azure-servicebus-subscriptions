import { gql } from 'apollo-server-express';

export const typeDefs = gql`
type Query {
  hello: String!
}

type Subscription {
  configChanged: ConfigUpdate
}

type ConfigUpdate {
  Update: String
}

schema {
  query: Query
  subscription: Subscription
}`;

