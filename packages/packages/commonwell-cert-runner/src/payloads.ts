#!/usr/bin/env node
import {
  AddressUseCodes,
  IdentifierUseCodes,
  NameUseCodes,
  Person,
} from "@metriport/commonwell-sdk";
import * as nanoid from "nanoid";
import { getEnvOrFail } from "./util";

const commonwellOID = getEnvOrFail("COMMONWELL_OID");
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
