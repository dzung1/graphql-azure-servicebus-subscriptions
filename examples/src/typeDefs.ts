import { gql } from 'apollo-server-express';

export const typeDefs = gql`
type Query {
  publishTestEvents: String!
}

type Subscription {
  status(id: String!): Status
}

type Status {
  id: String
  status: String
}

schema {
  query: Query
  subscription: Subscription
}`;

