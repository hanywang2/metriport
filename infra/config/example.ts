import { EnvConfig } from "../lib/env-config";
import { EnvType } from "../lib/env-type";

export const config: EnvConfig = {
  stackName: "MetriportInfraStack",
  secretsStackName: "MetriportSecretsStack",
  environmentType: EnvType.production,
  region: "us-east-1",
  host: "myhealthapp.com",
  domain: "myhealthapp.com",
  subdomain: "api",
  authSubdomain: "auth",
  dbName: "my_db",
  dbUsername: "my_db_user",
  providerSecretNames: {
    CRONOMETER_CLIENT_ID: "CRONOMETER_CLIENT_ID",
    CRONOMETER_CLIENT_SECRET: "CRONOMETER_CLIENT_SECRET",
    FITBIT_CLIENT_ID: "FITBIT_CLIENT_ID",
    FITBIT_CLIENT_SECRET: "FITBIT_CLIENT_SECRET",
    GARMIN_CONSUMER_KEY: "GARMIN_CONSUMER_KEY",
    GARMIN_CONSUMER_SECRET: "GARMIN_CONSUMER_SECRET",
    GOOGLE_CLIENT_ID: "GOOGLE_CLIENT_ID",
    GOOGLE_CLIENT_SECRET: "GOOGLE_CLIENT_SECRET",
    OURA_CLIENT_ID: "OURA_CLIENT_ID",
    OURA_CLIENT_SECRET: "OURA_CLIENT_SECRET",
    WITHINGS_CLIENT_ID: "WITHINGS_CLIENT_ID",
    WITHINGS_CLIENT_SECRET: "WITHINGS_CLIENT_SECRET",
    WHOOP_CLIENT_ID: "WHOOP_CLIENT_ID",
    WHOOP_CLIENT_SECRET: "WHOOP_CLIENT_SECRET",
  },
  cwSecretNames: {
    CW_PRIVATE_KEY: "CW_PRIVATE_KEY",
    CW_CERTIFICATE: "CW_CERTIFICATE",
    CW_MEMBER_PRIVATE_KEY: "CW_MEMBER_PRIVATE_KEY",
    CW_MEMBER_CERTIFICATE: "CW_MEMBER_CERTIFICATE",
    CW_GATEWAY_AUTHORIZATION_CLIENT_ID: "CW_GATEWAY_AUTHORIZATION_CLIENT_ID",
    CW_GATEWAY_AUTHORIZATION_CLIENT_SECRET: "CW_GATEWAY_AUTHORIZATION_CLIENT_SECRET",
  },
  connectWidget: {
    stackName: "MetriportConnectInfraStack",
    region: "us-east-1",
    subdomain: "connect",
    domain: "myhealthapp.com",
    host: "myhealthapp.com",
  },
  commonwell: {
    CW_MEMBER_NAME: "Test Org",
    CW_MEMBER_OID: "1.2.3.1.4.1.11.12.29.2022.123",
    CW_GATEWAY_ENDPOINT: "https://api.myhealthapp.com/oauth/fhir",
    CW_GATEWAY_AUTHORIZATION_SERVER_ENDPOINT:
      "https://myhealthapp.auth.us-east-1.amazoncognito.com/oauth2/token",
    CW_TECHNICAL_CONTACT_NAME: "Engineering",
    CW_TECHNICAL_CONTACT_TITLE: "Engineering",
    CW_TECHNICAL_CONTACT_EMAIL: "support@healthapp.com",
    CW_TECHNICAL_CONTACT_PHONE: "(123)-123-1234",
  },
  systemRootOID: "2.16.840.1.113883.3.999999",
};
export default config;
