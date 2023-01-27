#!/usr/bin/env node
import {
  AddressUseCodes,
  IdentifierUseCodes,
  NameUseCodes,
  Person,
} from "@metriport/commonwell-sdk";
import * as nanoid from "nanoid";
import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator";
import { getEnvOrFail } from "./util";

const commonwellOID = getEnvOrFail("COMMONWELL_OID");
const commonwellCertificate = getEnvOrFail("COMMONWELL_CERTIFICATE_CONTENT");
const commonwellOrgName = getEnvOrFail("COMMONWELL_ORG_NAME");

// PERSON
export const caDriversLicenseUri = "urn:oid:2.16.840.1.113883.4.3.6";
export const driversLicenseId = nanoid.nanoid();

export const identifier = {
  use: IdentifierUseCodes.usual,
  key: driversLicenseId,
  system: caDriversLicenseUri,
  period: {
    start: "1996-04-20T00:00:00Z",
  },
};

const mainDetails = {
  address: [
    {
      use: AddressUseCodes.home,
      zip: "94041",
      state: "CA",
      line: ["335 Pioneer Way"],
      city: "Mountain View",
    },
  ],
  name: [
    {
      use: NameUseCodes.usual,
      given: ["Paul"],
      family: ["Greyham"],
    },
  ],
  gender: {
    code: "M",
  },
  birthDate: "1980-04-20T00:00:00Z",
  identifier: [identifier],
};

const secondaryDetails = {
  address: [
    {
      use: AddressUseCodes.home,
      zip: "94111",
      state: "CA",
      line: ["755 Sansome Street"],
      city: "San Francisco",
    },
  ],
  name: [
    {
      use: NameUseCodes.usual,
      given: ["Mary"],
      family: ["Jane"],
    },
  ],
  gender: {
    code: "F",
  },
  birthDate: "2000-04-20T00:00:00Z",
};

export const personStrongId: Person = {
  details: {
    ...mainDetails,
    identifier: [identifier],
  },
};

export const personNoStrongId: Person = {
  details: secondaryDetails,
};

// PATIENT
export const patient = {
  identifier: [
    {
      use: "unspecified",
      label: commonwellOrgName,
      system: `urn:oid:${commonwellOID}`,
      key: nanoid.nanoid(),
      assigner: commonwellOrgName,
    },
  ],
  details: mainDetails,
};

export const mergePatient = {
  identifier: [
    {
      use: "unspecified",
      label: commonwellOrgName,
      system: `urn:oid:${commonwellOID}`,
      key: nanoid.nanoid(),
      assigner: commonwellOrgName,
    },
  ],
  details: secondaryDetails,
};

// ORGANIZATION
const appendOrgId = nanoid.customAlphabet("1234567890", 18)();
const shortName: string = uniqueNamesGenerator({
  dictionaries: [adjectives, colors, animals],
  separator: "-",
  length: 3,
});

export const organization = {
  organizationId: `urn:oid:${commonwellOID}.${appendOrgId}`,
  homeCommunityId: `urn:oid:${commonwellOID}.${appendOrgId}`,
  name: shortName,
  displayName: shortName,
  memberName: "Metriport",
  type: "Hospital",
  patientIdAssignAuthority: `urn:oid:${commonwellOID}.${appendOrgId}`,
  securityTokenKeyType: "BearerKey",
  isActive: true,
  locations: [
    {
      address1: "1 Main Street",
      address2: "PO Box 123",
      city: "Denver",
      state: "CO",
      postalCode: "80001",
      country: "USA",
      phone: "303-555-1212",
      fax: "303-555-1212",
      email: "here@dummymail.com",
    },
  ],
  technicalContacts: [
    {
      name: "Technician",
      title: "TechnicalContact",
      email: "technicalContact@dummymail.com",
      phone: "303-555-1212",
    },
  ],
};

export const thumbprint = "11E378F987D1C716B1FD5E08004E996AC806A9F1";
// CERTIFICATE
export const certificate = {
  Certificates: [
    {
      startDate: "2022-12-31T11:46:29Z",
      endDate: "2023-03-31T12:46:28Z",
      expirationDate: "2023-03-31T12:46:28Z",
      thumbprint: thumbprint,
      content: commonwellCertificate,
      purpose: "Authentication",
    },
  ],
};
