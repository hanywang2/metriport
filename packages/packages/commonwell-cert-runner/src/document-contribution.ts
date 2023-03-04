#!/usr/bin/env node
import { APIMode, CommonWell, isLOLA1, RequestMetadata } from "@metriport/commonwell-sdk";
import * as fs from "fs";
import { cloneDeep } from "lodash";
import {
  certificate,
  makeDocContribOrganization,
  makeDocPerson,
  makeId,
  makePatient,
} from "./payloads";
import { findOrCreatePatient, findOrCreatePerson } from "./shared-person";
import { getEnv, getEnvOrFail } from "./util";
import axios, { AxiosInstance } from "axios";

// Document Contribution
// https://commonwellalliance.sharepoint.com/sites/ServiceAdopter/SitePages/Document-Contribution-(SOAP,-REST).aspx

const commonwellPrivateKey = getEnvOrFail("COMMONWELL_PRIVATE_KEY");
const commonwellCert = getEnvOrFail("COMMONWELL_CERTIFICATE");

const orgIdSuffix = getEnvOrFail("DOCUMENT_CONTRIBUTION_ORGANIZATION_ID");

const firstName = getEnv("DOCUMENT_CONTRIBUTION_PATIENT_FIRST_NAME");
const lastName = getEnv("DOCUMENT_CONTRIBUTION_PATIENT_LAST_NAME");
const dob = getEnv("DOCUMENT_CONTRIBUTION_PATIENT_DATE_OF_BIRTH");
const gender = getEnv("DOCUMENT_CONTRIBUTION_PATIENT_GENDER");
const zip = getEnv("DOCUMENT_CONTRIBUTION_PATIENT_ZIP");

const fhirUrl = getEnvOrFail("DOCUMENT_CONTRIBUTION_FHIR_URL");
const docUrl = getEnvOrFail("DOCUMENT_CONTRIBUTION_URL");
const rootOid = getEnvOrFail("COMMONWELL_OID");

export async function documentContribution({
  memberManagementApi,
  api: apiDefaultOrg,
  queryMeta,
}: {
  memberManagementApi: CommonWell;
  api: CommonWell;
  queryMeta: RequestMetadata;
}) {
  console.log(`>>> E3: Query for documents served by Metriport's FHIR server`);

  const {
    orgAPI: apiNewOrg,
    orgName,
    orgId,
  } = await getOrCreateOrg(memberManagementApi, queryMeta);

  const person = makeDocPerson({
    firstName,
    lastName,
    zip,
    gender,
    dob,
    facilityId: apiDefaultOrg.oid,
  });

  console.log(`Find or create patient and person on main org`);
  const { personId, patientId: patientIdMainOrg } = await findOrCreatePerson(
    apiDefaultOrg,
    queryMeta,
    person
  );
  console.log(`personId: ${personId}`);
  console.log(`patientId on main org: ${patientIdMainOrg}`);

  const newPerson = cloneDeep(person);
  newPerson.identifier = makePatient({ facilityId: apiNewOrg.oid }).identifier;
  newPerson.identifier[0].assigner = orgName;
  newPerson.identifier[0].label = orgName;
  const { patientId: patientIdNewOrg } = await findOrCreatePatient(
    apiNewOrg,
    queryMeta,
    newPerson,
    personId
  );
  console.log(`patientId: ${patientIdNewOrg}`);

  console.log(`Get patients links`);
  const respGetLinks = await apiNewOrg.getPatientsLinks(queryMeta, patientIdNewOrg);
  console.log(respGetLinks);

  const allLinks = respGetLinks._embedded.networkLink;
  const lola1Links = allLinks.filter(isLOLA1);
  console.log(`Found ${allLinks.length} network links, ${lola1Links.length} are LOLA 1`);
  for (const link of lola1Links) {
    const respUpgradeLink = await apiNewOrg.upgradeOrDowngradeNetworkLink(
      queryMeta,
      link._links.upgrade.href
    );
    console.log(respUpgradeLink);
  }

  console.log(`>>> [E3] Populating test data on FHIR server...`);
  const fhirApi = axios.create({
    baseURL: fhirUrl,
  });
  const newPatientId = patientIdNewOrg.split("%5E%5E%5E")[0];
  await addOrgToFHIRServer(orgId, orgName, fhirApi);
  await addPatientToFHIRServer(newPatientId, fhirApi);
  await addDocumentRefAndBinaryToFHIRServer(newPatientId, orgId, orgName, fhirApi);

  console.log(`>>> [E3] Querying for docs from the main org...`);
  const respDocQuery = await apiDefaultOrg.queryDocuments(queryMeta, patientIdMainOrg);
  console.log(respDocQuery);
  const documents = respDocQuery.entry ?? [];
  for (const doc of documents) {
    console.log(`DOCUMENT: ${JSON.stringify(doc, undefined, 2)}`);

    // store the query result as well
    const queryFileName = `./cw_contribution_${doc.id ?? "ID"}_${makeId()}.response.file`;
    fs.writeFileSync(queryFileName, JSON.stringify(doc));

    const fileName = `./cw_contribution_${doc.id ?? "ID"}_${makeId()}.contents.file`;
    // the default is UTF-8, avoid changing the encoding if we don't know the file we're downloading
    const outputStream = fs.createWriteStream(fileName, { encoding: null });
    console.log(`File being created at ${process.cwd()}/${fileName}`);
    const url = doc.content?.location;
    if (url != null) await apiDefaultOrg.retrieveDocument(queryMeta, url, outputStream);
  }
}

async function getOrCreateOrg(
  memberManagementApi: CommonWell,
  queryMeta: RequestMetadata
): Promise<{ orgAPI: CommonWell; orgName: string; orgId: string }> {
  const orgPayload = makeDocContribOrganization(orgIdSuffix);
  const orgId = orgPayload.organizationId;
  const orgIdWithoutNamespace = orgId.slice("urn:oid:".length);
  const orgName = orgPayload.name;
  console.log(`Get the doc org - ID ${orgId}, name ${orgName}`);
  const respGetOneOrg = await memberManagementApi.getOneOrg(queryMeta, orgId);
  console.log(respGetOneOrg);
  if (!respGetOneOrg) {
    console.log(`Doc org not found, create one`);
    const respCreateOrg = await memberManagementApi.createOrg(queryMeta, orgPayload);
    console.log(respCreateOrg);
    console.log(`Add certificate to doc org`);
    const respAddCertificateToOrg = await memberManagementApi.addCertificateToOrg(
      queryMeta,
      certificate,
      orgIdWithoutNamespace
    );
    console.log(respAddCertificateToOrg);
  }

  const orgAPI = new CommonWell(
    commonwellCert,
    commonwellPrivateKey,
    orgName, //commonwellSandboxOrgName,
    orgIdWithoutNamespace, //commonwellSandboxOID,
    APIMode.integration
  );

  return { orgAPI, orgName, orgId: orgIdWithoutNamespace };
}

async function addOrgToFHIRServer(orgId: string, orgName: string, fhirApi: AxiosInstance) {
  const data = `{
    "resourceType": "Organization",
    "id": "${orgId}",
    "meta": {
        "versionId": "1",
        "lastUpdated": "2023-02-04T13:23:38.744+00:00",
        "source": "${rootOid}"
    },
    "identifier": [
        {
            "system": "urn:ietf:rfc:3986",
            "value": "${orgId}"
        }
    ],
    "active": true,
    "type": [
        {
            "coding": [
                {
                    "system": "http://terminology.hl7.org/CodeSystem/organization-type",
                    "code": "prov",
                    "display": "Healthcare Provider"
                }
            ],
            "text": "Healthcare Provider"
        }
    ],
    "name": "${orgName}",
    "telecom": [
        {
            "system": "phone",
            "value": "5088287000"
        }
    ],
    "address": [
        {
            "line": [
                "88 WASHINGTON STREET"
            ],
            "city": "TAUNTON",
            "state": "MA",
            "postalCode": "02780",
            "country": "US"
        }
    ]
}`;
  await fhirApi.put(`/Organization/${orgId}`, JSON.parse(data));
}

async function addPatientToFHIRServer(patientId: string, fhirApi: AxiosInstance) {
  const data = `{
    "resourceType": "Patient",
    "id": "${patientId}",
    "meta": {
        "versionId": "6",
        "lastUpdated": "2023-02-15T22:27:07.642+00:00",
        "source": "${rootOid}"
    },
    "extension": [
        {
            "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race",
            "extension": [
                {
                    "url": "ombCategory",
                    "valueCoding": {
                        "system": "urn:oid:2.16.840.1.113883.6.238",
                        "code": "2106-3",
                        "display": "White"
                    }
                },
                {
                    "url": "text",
                    "valueString": "White"
                }
            ]
        },
        {
            "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity",
            "extension": [
                {
                    "url": "ombCategory",
                    "valueCoding": {
                        "system": "urn:oid:2.16.840.1.113883.6.238",
                        "code": "2186-5",
                        "display": "Not Hispanic or Latino"
                    }
                },
                {
                    "url": "text",
                    "valueString": "Not Hispanic or Latino"
                }
            ]
        },
        {
            "url": "http://hl7.org/fhir/StructureDefinition/patient-mothersMaidenName",
            "valueString": "Deadra347 Borer986"
        },
        {
            "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex",
            "valueCode": "M"
        },
        {
            "url": "http://hl7.org/fhir/StructureDefinition/patient-birthPlace",
            "valueAddress": {
                "city": "Billerica",
                "state": "Massachusetts",
                "country": "US"
            }
        },
        {
            "url": "http://synthetichealth.github.io/synthea/disability-adjusted-life-years",
            "valueDecimal": 14.062655945052095
        },
        {
            "url": "http://synthetichealth.github.io/synthea/quality-adjusted-life-years",
            "valueDecimal": 58.93734405494791
        }
    ],
    "identifier": [
        {
            "system": "https://github.com/synthetichealth/synthea",
            "value": "2fa15bc7-8866-461a-9000-f739e425860a"
        },
        {
            "type": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                        "code": "MR",
                        "display": "Medical Record Number"
                    }
                ],
                "text": "Medical Record Number"
            },
            "system": "http://hospital.smarthealthit.org",
            "value": "2fa15bc7-8866-461a-9000-f739e425860a"
        },
        {
            "type": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                        "code": "SS",
                        "display": "Social Security Number"
                    }
                ],
                "text": "Social Security Number"
            },
            "system": "http://hl7.org/fhir/sid/us-ssn",
            "value": "999-93-7537"
        },
        {
            "type": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                        "code": "DL",
                        "display": "Driver's License"
                    }
                ],
                "text": "Driver's License"
            },
            "system": "urn:oid:2.16.840.1.113883.4.3.25",
            "value": "S99948707"
        },
        {
            "type": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                        "code": "PPN",
                        "display": "Passport Number"
                    }
                ],
                "text": "Passport Number"
            },
            "system": "http://standardhealthrecord.org/fhir/StructureDefinition/passportNumber",
            "value": "X14078167X"
        }
    ],
    "name": [
        {
            "use": "official",
            "family": "Rockefeller54",
            "given": [
                "Jonathan54"
            ],
            "prefix": [
                "Mr."
            ]
        }
    ],
    "telecom": [
        {
            "system": "phone",
            "value": "555-677-3119",
            "use": "home"
        }
    ],
    "gender": "male",
    "birthDate": "1983-12-22",
    "address": [
        {
            "extension": [
                {
                    "url": "http://hl7.org/fhir/StructureDefinition/geolocation",
                    "extension": [
                        {
                            "url": "latitude",
                            "valueDecimal": 41.93879298871088
                        },
                        {
                            "url": "longitude",
                            "valueDecimal": -71.06682353144593
                        }
                    ]
                }
            ],
            "line": [
                "894 Brakus Bypass"
            ],
            "city": "San Francisco",
            "state": "California",
            "postalCode": "81547",
            "country": "US"
        }
    ],
    "maritalStatus": {
        "coding": [
            {
                "system": "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
                "code": "S",
                "display": "S"
            }
        ],
        "text": "S"
    },
    "multipleBirthBoolean": false,
    "communication": [
        {
            "language": {
                "coding": [
                    {
                        "system": "urn:ietf:bcp:47",
                        "code": "en-US",
                        "display": "English"
                    }
                ],
                "text": "English"
            }
        }
    ]
}`;
  await fhirApi.put(`/Patient/${patientId}`, JSON.parse(data));
}

async function addDocumentRefAndBinaryToFHIRServer(
  patientId: string,
  orgId: string,
  orgName: string,
  fhirApi: AxiosInstance
): Promise<{ docRefId: string; binaryId: string }> {
  const binaryId = `${orgId}.969696`;
  const binaryData = `{
    "resourceType": "Binary",
    "id": "${binaryId}",
    "contentType": "application/xml",
    "data": "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4NCjw/eG1sLXN0eWxlc2hlZXQgdHlwZT0idGV4dC94c2wiIGhyZWY9IkNEQS54c2wiPz4NCjwhLS0NCiBUaXRsZTogICAgICAgIENvbnRpbnVpdHkgb2YgQ2FyZSBEb2N1bWVudCAoQ0NEKQ0KIEZpbGVuYW1lOiAgICAgQy1DREFfUjJfQ0NEXzIueG1sIA0KIENyZWF0ZWQgYnk6ICAgTGFudGFuYSBDb25zdWx0aW5nIEdyb3VwLCBMTEMNCiANCiAkTGFzdENoYW5nZWREYXRlOiAyMDE0LTExLTEyIDIzOjI1OjA5IC0wNTAwIChXZWQsIDEyIE5vdiAyMDE0KSAkDQogIA0KICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqDQogRGlzY2xhaW1lcjogVGhpcyBzYW1wbGUgZmlsZSBjb250YWlucyByZXByZXNlbnRhdGl2ZSBkYXRhIGVsZW1lbnRzIHRvIHJlcHJlc2VudCBhIENvbnRpbnVpdHkgb2YgQ2FyZSBEb2N1bWVudCAoQ0NEKS4gDQogVGhlIGZpbGUgZGVwaWN0cyBhIGZpY3Rpb25hbCBjaGFyYWN0ZXIncyBoZWFsdGggZGF0YS4gQW55IHJlc2VtYmxhbmNlIHRvIGEgcmVhbCBwZXJzb24gaXMgY29pbmNpZGVudGFsLiANCiBUbyBpbGx1c3RyYXRlIGFzIG1hbnkgZGF0YSBlbGVtZW50cyBhcyBwb3NzaWJsZSwgdGhlIGNsaW5pY2FsIHNjZW5hcmlvIG1heSBub3QgYmUgcGxhdXNpYmxlLiANCiBUaGUgZGF0YSBpbiB0aGlzIHNhbXBsZSBmaWxlIGlzIG5vdCBpbnRlbmRlZCB0byByZXByZXNlbnQgcmVhbCBwYXRpZW50cywgcGVvcGxlIG9yIGNsaW5pY2FsIGV2ZW50cy4gDQogVGhpcyBzYW1wbGUgaXMgZGVzaWduZWQgdG8gYmUgdXNlZCBpbiBjb25qdW5jdGlvbiB3aXRoIHRoZSBDLUNEQSBDbGluaWNhbCBOb3RlcyBJbXBsZW1lbnRhdGlvbiBHdWlkZS4NCiAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKg0KIC0tPg0KPCEtLSBUaGlzIENDRF8yIGlsbHVzdHJhdGVzIGhvdyB0byByZXByZXNlbnQgIm5vIGtub3duIiwgIm5vIGluZm9ybWF0aW9uIiwgYW5kICJwZW5kaW5nIiBpbiBzb21lIHNlY3Rpb25zLg0KCUluIGFkZGl0aW9uIGl0IHByb3ZpZGVzIHNldmVyYWwgb3RoZXIgc2VjdGlvbmFsIGRhdGEgKGUuZy4gVml0YWwgU2lnbnMpIGRpZmZlcmVudCB0aGFuIG90aGVyIHNhbXBsZSBDQ0QgLS0+DQo8Q2xpbmljYWxEb2N1bWVudCB4bWxuczp4c2k9Imh0dHA6Ly93d3cudzMub3JnLzIwMDEvWE1MU2NoZW1hLWluc3RhbmNlIiB4bWxucz0idXJuOmhsNy1vcmc6djMiIHhtbG5zOnZvYz0idXJuOmhsNy1vcmc6djMvdm9jIiB4bWxuczpzZHRjPSJ1cm46aGw3LW9yZzpzZHRjIj4NCgk8IS0tICoqIENEQSBIZWFkZXIgKiogLS0+DQoJPHJlYWxtQ29kZSBjb2RlPSJVUyIvPg0KCTx0eXBlSWQgZXh0ZW5zaW9uPSJQT0NEX0hEMDAwMDQwIiByb290PSIyLjE2Ljg0MC4xLjExMzg4My4xLjMiLz4NCgk8IS0tIENDRCBkb2N1bWVudCB0ZW1wbGF0ZSB3aXRoaW4gQy1DREEgMi4wLS0+DQoJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuMS4yIiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgk8IS0tIEdsb2JhbGx5IHVuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgZG9jdW1lbnQuIENhbiBvbmx5IGJlIFsxLi4xXSAtLT4NCgk8aWQgZXh0ZW5zaW9uPSJFSFJWZXJzaW9uMi4wIiByb290PSJiZTg0YThlNC1hMjJlLTQyMTAtYTRhNi1iM2M0ODI3M2U4NGMiLz4NCgk8Y29kZSBjb2RlPSIzNDEzMy05IiBkaXNwbGF5TmFtZT0iU3VtbWFyaXphdGlvbiBvZiBFcGlzb2RlIE5vdGUiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMSIgY29kZVN5c3RlbU5hbWU9IkxPSU5DIi8+DQoJPCEtLSBUaXRsZSBvZiB0aGlzIGRvY3VtZW50IC0tPg0KCTx0aXRsZT5TdW1tYXJ5IG9mIFBhdGllbnQgQ2hhcnQ8L3RpdGxlPg0KCTwhLS0gVGhpcyBpcyB0aGUgdGltZSBvZiBkb2N1bWVudCBnZW5lcmF0aW9uIC0tPg0KCTxlZmZlY3RpdmVUaW1lIHZhbHVlPSIyMDE0MTAxNTEwMzAyNi0wNTAwIi8+DQoJPGNvbmZpZGVudGlhbGl0eUNvZGUgY29kZT0iTiIgZGlzcGxheU5hbWU9Im5vcm1hbCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNS4yNSIgY29kZVN5c3RlbU5hbWU9IkNvbmZpZGVudGlhbGl0eSIvPg0KCTwhLS0gVGhpcyBpcyB0aGUgZG9jdW1lbnQgbGFuZ3VhZ2UgY29kZSB3aGljaCB1c2VzIGludGVybmV0IHN0YW5kYXJkIFJGQyA0NjQ2LiBUaGlzIG9mdGVuIGRpZmZlcnMgZnJvbSBwYXRpZW50IGxhbmd1YWdlIHdpdGhpbiByZWNvcmRUYXJnZXQgLS0+DQoJPGxhbmd1YWdlQ29kZSBjb2RlPSJlbi1VUyIvPg0KCTxzZXRJZCBleHRlbnNpb249InNUVDk4OCIgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTkuNS45OTk5OS4xOSIvPg0KCTwhLS0gVmVyc2lvbiBvZiB0aGlzIGRvY3VtZW50IC0tPg0KCTx2ZXJzaW9uTnVtYmVyIHZhbHVlPSIxIi8+DQoJPHJlY29yZFRhcmdldD4NCgkJPHBhdGllbnRSb2xlPg0KCQkJPCEtLSBUaGUgaWQgd291bGQgbGlrZWx5IGJlIHRoZSBwYXRpZW50J3MgbWVkaWNhbCByZWNvcmQgbnVtYmVyLiBUaGlzIHJvb3QgaWRlbnRpZmllcyBQYXJ0bmVycyBIZWFsdGhjYXJlIGFzIGFuIGV4YW1wbGUgLS0+DQoJCQk8aWQgZXh0ZW5zaW9uPSI5ODc2NTQzMiIgcm9vdD0iMS4zLjYuMS40LjEuMTY1MTcuMSIvPg0KCQkJPCEtLSBBZGRpdGlvbmFsIGlkcyBjYW4gY2FwdHVyZSBvdGhlciBNUk5zIG9yIGlkZW50aWZpZXJzLCBzdWNoIGFzIHNvY2lhbCBzZWN1cml0eSBudW1iZXIgc2hvd24gYmVsb3cgLS0+DQoJCQk8aWQgZXh0ZW5zaW9uPSIxMjM0NTY3OSIgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuNC4xIi8+DQoJCQk8IS0tIEhQIGlzICJwcmltYXJ5IGhvbWUiIGZyb20gdmFsdWVTZXQgMi4xNi44NDAuMS4xMTM4ODMuMS4xMS4xMDYzNyAtLT4NCgkJCTxhZGRyIHVzZT0iSFAiPg0KCQkJCTwhLS0gWW91IGNhbiBoYXZlIG11bHRpcGxlIFsxLi40XSBzdHJlZXRBZGRyZXNzTGluZSBlbGVtZW50cy4gU2luZ2xlIHNob3duIGJlbG93IC0tPg0KCQkJCTxzdHJlZXRBZGRyZXNzTGluZT40NTY3IFJlc2lkZW5jZSBSZDwvc3RyZWV0QWRkcmVzc0xpbmU+DQoJCQkJPGNpdHk+QmVhdmVydG9uPC9jaXR5Pg0KCQkJCTwhLS0gNSBvciA5IGRpZ2l0IHppcCBjb2RlcyBmcm9tIHZhbHVlU2V0IDIuMTYuODQwLjEuMTEzODgzLjMuODguMTIuODAuMi0tPg0KCQkJCTwhLS0gUG9zdGFsQ29kZSBpcyByZXF1aXJlZCBpZiB0aGUgY291bnRyeSBpcyBVUy4gSWYgY291bnRyeSBpcyBub3Qgc3BlY2lmaWVkLCBpdCdzIGFzc3VtZWQgdG8gYmUgVVMuIElmIGNvdW50cnkgDQoJCQkJCWlzIHNvbWV0aGluZyBvdGhlciB0aGFuIFVTLCB0aGUgcG9zdGFsQ29kZSBNQVkgYmUgcHJlc2VudCBidXQgTUFZIGJlIGJvdW5kIHRvIGRpZmZlcmVudCB2b2NhYnVsYXJpZXMgLS0+DQoJCQkJPHBvc3RhbENvZGU+OTc4Njc8L3Bvc3RhbENvZGU+DQoJCQkJPCEtLSBTdGF0ZSBpcyByZXF1aXJlZCBpZiB0aGUgY291bnRyeSBpcyBVUy4gSWYgY291bnRyeSBpcyBub3Qgc3BlY2lmaWVkLCBpdCdzIGFzc3VtZWQgdG8gYmUgVVMuIA0KCQkJCQlJZiBjb3VudHJ5IGlzIHNvbWV0aGluZyBvdGhlciB0aGFuIFVTLCB0aGUgc3RhdGUgTUFZIGJlIHByZXNlbnQgYnV0IE1BWSBiZSBib3VuZCB0byBkaWZmZXJlbnQgdm9jYWJ1bGFyaWVzIC0tPg0KCQkJCTwhLS0gT1IgaXMgIk9yZWdvbiIgZnJvbSB2YWx1ZVNldCAyLjE2Ljg0MC4xLjExMzg4My4zLjg4LjEyLjgwLjEgLS0+DQoJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQk8IS0tIFVTIGlzICJVbml0ZWQgU3RhdGVzIiBmcm9tIHZhbHVlU2V0IDIuMTYuODQwLjEuMTEzODgzLjMuODguMTIuODAuNjMgLS0+DQoJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQk8L2FkZHI+DQoJCQk8IS0tIE1DIGlzICJtb2JpbGUgY29udGFjdCIgZnJvbSBITDcgQWRkcmVzc1VzZSAyLjE2Ljg0MC4xLjExMzg4My41LjExMTkgLS0+DQoJCQk8dGVsZWNvbSB2YWx1ZT0idGVsOisxKDQ0NCk0NDQtNDQ0NCIgdXNlPSJNQyIvPg0KCQkJPCEtLSBNdWx0aXBsZSB0ZWxlY29tcyBhcmUgcG9zc2libGUgLS0+DQoJCQk8dGVsZWNvbSB2YWx1ZT0ibWFpbHRvOi8vSXNiZWxsYS5Kb25lcy5DQ0RAZ21haWwuY29tIi8+DQoJCQk8cGF0aWVudD4NCgkJCQk8bmFtZSB1c2U9IkwiPg0KCQkJCQk8Z2l2ZW4+SXNhYmVsbGE8L2dpdmVuPg0KCQkJCQk8ZmFtaWx5IHF1YWxpZmllcj0iU1AiPkpvbmVzPC9mYW1pbHk+DQoJCQkJPC9uYW1lPg0KCQkJCTxhZG1pbmlzdHJhdGl2ZUdlbmRlckNvZGUgY29kZT0iRiIgZGlzcGxheU5hbWU9IkZlbWFsZSIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNS4xIiBjb2RlU3lzdGVtTmFtZT0iQWRtaW5pc3RyYXRpdmVHZW5kZXIiLz4NCgkJCQk8IS0tIERhdGUgb2YgYmlydGggbmVlZCBvbmx5IGJlIHByZWNpc2UgdG8gdGhlIGRheSAtLT4NCgkJCQk8YmlydGhUaW1lIHZhbHVlPSIxOTUwMTIxOSIvPg0KCQkJCTxtYXJpdGFsU3RhdHVzQ29kZSBjb2RlPSJNIiBkaXNwbGF5TmFtZT0iTWFycmllZCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNS4yIiBjb2RlU3lzdGVtTmFtZT0iTWFyaXRhbFN0YXR1c0NvZGUiLz4NCgkJCQk8cmVsaWdpb3VzQWZmaWxpYXRpb25Db2RlIGNvZGU9IjEwMTMiIGRpc3BsYXlOYW1lPSJDaHJpc3RpYW4gKG5vbi1DYXRob2xpYywgbm9uLXNwZWNpZmljKSIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNS4xMDc2IiBjb2RlU3lzdGVtTmFtZT0iSEw3IFJlbGlnaW91cyBBZmZpbGlhdGlvbiIvPg0KCQkJCTwhLS0gQ0RDIFJhY2UgYW5kIEV0aG5pY2l0eSBjb2RlIHNldCBjb250YWlucyB0aGUgZml2ZSBtaW5pbXVtIHJhY2UgYW5kIGV0aG5pY2l0eSBjYXRlZ29yaWVzIGRlZmluZWQgYnkgT01CIFN0YW5kYXJkcyAtLT4NCgkJCQk8cmFjZUNvZGUgY29kZT0iMjEwNi0zIiBkaXNwbGF5TmFtZT0iV2hpdGUiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMjM4IiBjb2RlU3lzdGVtTmFtZT0iUmFjZSAmYW1wOyBFdGhuaWNpdHkgLSBDREMiLz4NCgkJCQk8IS0tIFRoZSByYWNlQ29kZSBleHRlbnNpb24gaXMgb25seSB1c2VkIGlmIHJhY2VDb2RlIGlzIHZhbHVlZCAtLT4NCgkJCQk8c2R0YzpyYWNlQ29kZSBjb2RlPSIyMTE0LTciIGRpc3BsYXlOYW1lPSJJdGFsaWFuIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42LjIzOCIgY29kZVN5c3RlbU5hbWU9IlJhY2UgJmFtcDsgRXRobmljaXR5IC0gQ0RDIi8+DQoJCQkJPGV0aG5pY0dyb3VwQ29kZSBjb2RlPSIyMTg2LTUiIGRpc3BsYXlOYW1lPSJOb3QgSGlzcGFuaWMgb3IgTGF0aW5vIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42LjIzOCIgY29kZVN5c3RlbU5hbWU9IlJhY2UgJmFtcDsgRXRobmljaXR5IC0gQ0RDIi8+DQoJCQkJPGd1YXJkaWFuPg0KCQkJCQk8Y29kZSBjb2RlPSJQT1dBVFQiIGRpc3BsYXlOYW1lPSJQb3dlciBvZiBBdHRvcm5leSIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuMS4xMS4xOTgzMCIgY29kZVN5c3RlbU5hbWU9IlJlc3BvbnNpYmxlUGFydHkiLz4NCgkJCQkJPGFkZHIgdXNlPSJIUCI+DQoJCQkJCQk8c3RyZWV0QWRkcmVzc0xpbmU+NDU2NyBSZXNpZGVuY2UgUmQ8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCQkJPGNpdHk+QmVhdmVydG9uPC9jaXR5Pg0KCQkJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQkJCTxwb3N0YWxDb2RlPjk3ODY3PC9wb3N0YWxDb2RlPg0KCQkJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQkJCTwvYWRkcj4NCgkJCQkJPHRlbGVjb20gdmFsdWU9InRlbDorMSg0NDQpNDQ0LTQ0NDQiIHVzZT0iTUMiLz4NCgkJCQkJPGd1YXJkaWFuUGVyc29uPg0KCQkJCQkJPG5hbWU+DQoJCQkJCQkJPGdpdmVuPkJvcmlzPC9naXZlbj4NCgkJCQkJCQk8Z2l2ZW4gcXVhbGlmaWVyPSJDTCI+Qm88L2dpdmVuPg0KCQkJCQkJCTxmYW1pbHk+Sm9uZXM8L2ZhbWlseT4NCgkJCQkJCTwvbmFtZT4NCgkJCQkJPC9ndWFyZGlhblBlcnNvbj4NCgkJCQk8L2d1YXJkaWFuPg0KCQkJCTxiaXJ0aHBsYWNlPg0KCQkJCQk8cGxhY2U+DQoJCQkJCQk8YWRkcj4NCgkJCQkJCQk8c3RyZWV0QWRkcmVzc0xpbmU+NDQ0NCBIb21lIFN0cmVldDwvc3RyZWV0QWRkcmVzc0xpbmU+DQoJCQkJCQkJPGNpdHk+QmVhdmVydG9uPC9jaXR5Pg0KCQkJCQkJCTxzdGF0ZT5PUjwvc3RhdGU+DQoJCQkJCQkJPHBvc3RhbENvZGU+OTc4Njc8L3Bvc3RhbENvZGU+DQoJCQkJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQkJCQk8L2FkZHI+DQoJCQkJCTwvcGxhY2U+DQoJCQkJPC9iaXJ0aHBsYWNlPg0KCQkJCTxsYW5ndWFnZUNvbW11bmljYXRpb24+DQoJCQkJCTxsYW5ndWFnZUNvZGUgY29kZT0iaXRhIi8+DQoJCQkJCTwhLS0gIml0YSIgaXMgSVNPIDYzOS0yIGFscGhhLTMgY29kZSBmb3IgIkl0YWxpYW4iIC0tPg0KCQkJCQk8bW9kZUNvZGUgY29kZT0iRVNQIiBkaXNwbGF5TmFtZT0iRXhwcmVzc2VkIHNwb2tlbiIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNS42MCIgY29kZVN5c3RlbU5hbWU9Ikxhbmd1YWdlQWJpbGl0eU1vZGUiLz4NCgkJCQkJPHByb2ZpY2llbmN5TGV2ZWxDb2RlIGNvZGU9IkciIGRpc3BsYXlOYW1lPSJHb29kIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My41LjYxIiBjb2RlU3lzdGVtTmFtZT0iTGFuZ3VhZ2VBYmlsaXR5UHJvZmljaWVuY3kiLz4NCgkJCQkJPCEtLSBQYXRpZW50J3MgcHJlZmVycmVkIGxhbmd1YWdlIC0tPg0KCQkJCQk8cHJlZmVyZW5jZUluZCB2YWx1ZT0idHJ1ZSIvPg0KCQkJCTwvbGFuZ3VhZ2VDb21tdW5pY2F0aW9uPg0KCQkJCTxsYW5ndWFnZUNvbW11bmljYXRpb24+DQoJCQkJCTxsYW5ndWFnZUNvZGUgY29kZT0iZW5nIi8+DQoJCQkJCTwhLS0gImVuZyIgaXMgSVNPIDYzOS0yIGFscGhhLTMgY29kZSBmb3IgIkVuZ2xpc2giIC0tPg0KCQkJCQk8bW9kZUNvZGUgY29kZT0iRVNQIiBkaXNwbGF5TmFtZT0iRXhwcmVzc2VkIHNwb2tlbiIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNS42MCIgY29kZVN5c3RlbU5hbWU9Ikxhbmd1YWdlQWJpbGl0eU1vZGUiLz4NCgkJCQkJPHByb2ZpY2llbmN5TGV2ZWxDb2RlIGNvZGU9IlAiIGRpc3BsYXlOYW1lPSJQb29yIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My41LjYxIiBjb2RlU3lzdGVtTmFtZT0iTGFuZ3VhZ2VBYmlsaXR5UHJvZmljaWVuY3kiLz4NCgkJCQkJPCEtLSBQYXRpZW50J3MgcHJlZmVycmVkIGxhbmd1YWdlIC0tPg0KCQkJCQk8cHJlZmVyZW5jZUluZCB2YWx1ZT0iZmFsc2UiLz4NCgkJCQk8L2xhbmd1YWdlQ29tbXVuaWNhdGlvbj4NCgkJCTwvcGF0aWVudD4NCgkJCTxwcm92aWRlck9yZ2FuaXphdGlvbj4NCgkJCQk8aWQgZXh0ZW5zaW9uPSIyMTlCWCIgcm9vdD0iMS4xLjEuMS4xLjEuMS4xLjIiLz4NCgkJCQk8bmFtZT5UaGUgRG9jdG9ycyBUb2dldGhlciBQaHlzaWNpYW4gR3JvdXA8L25hbWU+DQoJCQkJPHRlbGVjb20gdXNlPSJXUCIgdmFsdWU9InRlbDogKzEoNTU1KTU1NS01MDAwIi8+DQoJCQkJPGFkZHI+DQoJCQkJCTxzdHJlZXRBZGRyZXNzTGluZT4xMDA3IEhlYWx0aCBEcml2ZTwvc3RyZWV0QWRkcmVzc0xpbmU+DQoJCQkJCTxjaXR5PlBvcnRsYW5kPC9jaXR5Pg0KCQkJCQk8c3RhdGU+T1I8L3N0YXRlPg0KCQkJCQk8cG9zdGFsQ29kZT45OTEyMzwvcG9zdGFsQ29kZT4NCgkJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQkJPC9hZGRyPg0KCQkJPC9wcm92aWRlck9yZ2FuaXphdGlvbj4NCgkJPC9wYXRpZW50Um9sZT4NCgk8L3JlY29yZFRhcmdldD4NCgk8IS0tIFRoZSBhdXRob3IgcmVwcmVzZW50cyB0aGUgcGVyc29uIHdobyBwcm92aWRlcyB0aGUgY29udGVudCBpbiB0aGUgZG9jdW1lbnQgLS0+DQoJPGF1dGhvcj4NCgkJPHRpbWUgdmFsdWU9IjIwMTQxMDE1MTAzMDI2LTA1MDAiLz4NCgkJPGFzc2lnbmVkQXV0aG9yPg0KCQkJPGlkIGV4dGVuc2lvbj0iNTU1NTU1NTU1NSIgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuNC42Ii8+DQoJCQk8Y29kZSBjb2RlPSIyMDdRQTA1MDVYIiBkaXNwbGF5TmFtZT0iQWR1bHQgTWVkaWNpbmUiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMTAxIiBjb2RlU3lzdGVtTmFtZT0iSGVhbHRoY2FyZSBQcm92aWRlciBUYXhvbm9teSAoSElQQUEpIi8+DQoJCQk8YWRkcj4NCgkJCQk8c3RyZWV0QWRkcmVzc0xpbmU+MTAwNCBIZWFsdGhjYXJlIERyaXZlIDwvc3RyZWV0QWRkcmVzc0xpbmU+DQoJCQkJPGNpdHk+UG9ydGxhbmQ8L2NpdHk+DQoJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQk8cG9zdGFsQ29kZT45OTEyMzwvcG9zdGFsQ29kZT4NCgkJCQk8Y291bnRyeT5VUzwvY291bnRyeT4NCgkJCTwvYWRkcj4NCgkJCTx0ZWxlY29tIHVzZT0iV1AiIHZhbHVlPSJ0ZWw6KzEoNTU1KTU1NS0xMDA0Ii8+DQoJCQk8YXNzaWduZWRQZXJzb24+DQoJCQkJPG5hbWU+DQoJCQkJCTxnaXZlbj5QYXRyaWNpYTwvZ2l2ZW4+DQoJCQkJCTxnaXZlbiBxdWFsaWZpZXI9IkNMIj5QYXR0eTwvZ2l2ZW4+DQoJCQkJCTxmYW1pbHk+UHJpbWFyeTwvZmFtaWx5Pg0KCQkJCQk8c3VmZml4IHF1YWxpZmllcj0iQUMiPk0uRC48L3N1ZmZpeD4NCgkJCQk8L25hbWU+DQoJCQk8L2Fzc2lnbmVkUGVyc29uPg0KCQk8L2Fzc2lnbmVkQXV0aG9yPg0KCTwvYXV0aG9yPg0KCTwhLS0gV2hpbGUgbm90IHJlcXVpcmVkLCBhIHNlY29uZCBhdXRob3IgbWF5IGJlIGFwcHJvcHJpYXRlIHRvIHJlcHJlc2VudCBFSFIgc29mdHdhcmUgdXNlZC0tPg0KCTxhdXRob3I+DQoJCTx0aW1lIHZhbHVlPSIyMDE0MTAxNTEwMzAyNi0wNTAwIi8+DQoJCTxhc3NpZ25lZEF1dGhvcj4NCgkJCTxpZCBudWxsRmxhdm9yPSJOSSIvPg0KCQkJPGFkZHI+DQoJCQkJPHN0cmVldEFkZHJlc3NMaW5lPjEwMDQgSGVhbHRoY2FyZSBEcml2ZSA8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCTxjaXR5PlBvcnRsYW5kPC9jaXR5Pg0KCQkJCTxzdGF0ZT5PUjwvc3RhdGU+DQoJCQkJPHBvc3RhbENvZGU+OTkxMjM8L3Bvc3RhbENvZGU+DQoJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQk8L2FkZHI+DQoJCQk8dGVsZWNvbSB1c2U9IldQIiB2YWx1ZT0idGVsOisxKDU1NSk1NTUtMTAwNCIvPg0KCQkJPGFzc2lnbmVkQXV0aG9yaW5nRGV2aWNlPg0KCQkJCTxtYW51ZmFjdHVyZXJNb2RlbE5hbWU+R2VuZXJpYyBFSFIgQ2xpbmljYWwgU3lzdGVtIDIuMC4wLjAuMC4wPC9tYW51ZmFjdHVyZXJNb2RlbE5hbWU+DQoJCQkJPHNvZnR3YXJlTmFtZT5HZW5lcmljIEVIUiBDLUNEQSBGYWN0b3J5IDIuMC4wLjAuMC4wIC0gQy1DREEgVHJhbnNmb3JtIDIuMC4wLjAuMDwvc29mdHdhcmVOYW1lPg0KCQkJPC9hc3NpZ25lZEF1dGhvcmluZ0RldmljZT4NCgkJCTxyZXByZXNlbnRlZE9yZ2FuaXphdGlvbj4NCgkJCQk8aWQgZXh0ZW5zaW9uPSIzIiByb290PSIxLjMuNi4xLjQuMS4yMjgxMi4zLjk5OTMwLjMiLz4NCgkJCQk8bmFtZT5UaGUgRG9jdG9ycyBUb2dldGhlciBQaHlzaWNpYW4gR3JvdXA8L25hbWU+DQoJCQkJPHRlbGVjb20gdmFsdWU9InRlbDorMSg1NTUpNTU1LTEwMDQiLz4NCgkJCQk8YWRkcj4NCgkJCQkJPHN0cmVldEFkZHJlc3NMaW5lPjEwMDQgSGVhbHRoY2FyZSBEcml2ZSA8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCQk8Y2l0eT5Qb3J0bGFuZDwvY2l0eT4NCgkJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQkJPHBvc3RhbENvZGU+OTkxMjM8L3Bvc3RhbENvZGU+DQoJCQkJCTxjb3VudHJ5PlVTPC9jb3VudHJ5Pg0KCQkJCTwvYWRkcj4NCgkJCTwvcmVwcmVzZW50ZWRPcmdhbml6YXRpb24+DQoJCTwvYXNzaWduZWRBdXRob3I+DQoJPC9hdXRob3I+DQoJPCEtLSBUaGUgZGF0YUVudGVyZXIgdHJhbnNmZXJyZWQgdGhlIGNvbnRlbnQgY3JlYXRlZCBieSB0aGUgYXV0aG9yIGludG8gdGhlIGRvY3VtZW50IC0tPg0KCTxkYXRhRW50ZXJlcj4NCgkJPGFzc2lnbmVkRW50aXR5Pg0KCQkJPGlkIGV4dGVuc2lvbj0iMzMzNzc3Nzc3IiByb290PSIyLjE2Ljg0MC4xLjExMzg4My40LjYiLz4NCgkJCTxhZGRyPg0KCQkJCTxzdHJlZXRBZGRyZXNzTGluZT4xMDA3IEhlYWx0aGNhcmUgRHJpdmU8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCTxjaXR5PlBvcnRsYW5kPC9jaXR5Pg0KCQkJCTxzdGF0ZT5PUjwvc3RhdGU+DQoJCQkJPHBvc3RhbENvZGU+OTkxMjM8L3Bvc3RhbENvZGU+DQoJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQk8L2FkZHI+DQoJCQk8dGVsZWNvbSB1c2U9IldQIiB2YWx1ZT0idGVsOisxKDU1NSk1NTUtMTA1MCIvPg0KCQkJPGFzc2lnbmVkUGVyc29uPg0KCQkJCTxuYW1lPg0KCQkJCQk8Z2l2ZW4+RWxsZW48L2dpdmVuPg0KCQkJCQk8ZmFtaWx5PkVudGVyPC9mYW1pbHk+DQoJCQkJPC9uYW1lPg0KCQkJPC9hc3NpZ25lZFBlcnNvbj4NCgkJPC9hc3NpZ25lZEVudGl0eT4NCgk8L2RhdGFFbnRlcmVyPg0KCTwhLS0gVGhlIGluZm9ybWFudCByZXByZXNlbnRzIGFueSBzb3VyY2VzIG9mIGluZm9ybWF0aW9uIGZvciBkb2N1bWVudCBjb250ZW50IC0tPg0KCTxpbmZvcm1hbnQ+DQoJCTxhc3NpZ25lZEVudGl0eT4NCgkJCTxpZCBleHRlbnNpb249IjMzMzQ0NDQ0NCIgcm9vdD0iMS4xLjEuMS4xLjEuMS40Ii8+DQoJCQk8YWRkcj4NCgkJCQk8c3RyZWV0QWRkcmVzc0xpbmU+MTAxNyBIZWFsdGggRHJpdmU8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCTxjaXR5PlBvcnRsYW5kPC9jaXR5Pg0KCQkJCTxzdGF0ZT5PUjwvc3RhdGU+DQoJCQkJPHBvc3RhbENvZGU+OTkxMjM8L3Bvc3RhbENvZGU+DQoJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQk8L2FkZHI+DQoJCQk8dGVsZWNvbSB1c2U9IldQIiB2YWx1ZT0idGVsOisxKDU1NSk1NTUtMTAxNyIvPg0KCQkJPGFzc2lnbmVkUGVyc29uPg0KCQkJCTxuYW1lPg0KCQkJCQk8Z2l2ZW4+V2lsbGlhbTwvZ2l2ZW4+DQoJCQkJCTxnaXZlbiBxdWFsaWZpZXI9IkNMIj5CaWxsPC9naXZlbj4NCgkJCQkJPGZhbWlseT5CZWFrZXI8L2ZhbWlseT4NCgkJCQk8L25hbWU+DQoJCQk8L2Fzc2lnbmVkUGVyc29uPg0KCQkJPHJlcHJlc2VudGVkT3JnYW5pemF0aW9uPg0KCQkJCTxuYW1lPkdvb2QgSGVhbHRoIExhYm9yYXRvcnk8L25hbWU+DQoJCQk8L3JlcHJlc2VudGVkT3JnYW5pemF0aW9uPg0KCQk8L2Fzc2lnbmVkRW50aXR5Pg0KCTwvaW5mb3JtYW50Pg0KCTxpbmZvcm1hbnQ+DQoJCTxyZWxhdGVkRW50aXR5IGNsYXNzQ29kZT0iUFJTIj4NCgkJCTwhLS0gY2xhc3NDb2RlICJQUlMiIHJlcHJlc2VudHMgYSBwZXJzb24gd2l0aCBwZXJzb25hbCByZWxhdGlvbnNoaXAgd2l0aCB0aGUgcGF0aWVudCAtLT4NCgkJCTxjb2RlIGNvZGU9IlNQUyIgZGlzcGxheU5hbWU9IlNQT1VTRSIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuMS4xMS4xOTU2MyIgY29kZVN5c3RlbU5hbWU9IlBlcnNvbmFsIFJlbGF0aW9uc2hpcCBSb2xlIFR5cGUgVmFsdWUgU2V0Ii8+DQoJCQk8cmVsYXRlZFBlcnNvbj4NCgkJCQk8bmFtZT4NCgkJCQkJPGdpdmVuPkJvcmlzPC9naXZlbj4NCgkJCQkJPGdpdmVuIHF1YWxpZmllcj0iQ0wiPkJvPC9naXZlbj4NCgkJCQkJPGZhbWlseT5Kb25lczwvZmFtaWx5Pg0KCQkJCTwvbmFtZT4NCgkJCTwvcmVsYXRlZFBlcnNvbj4NCgkJPC9yZWxhdGVkRW50aXR5Pg0KCTwvaW5mb3JtYW50Pg0KCTwhLS0gVGhlIGN1c3RvZGlhbiByZXByZXNlbnRzIHRoZSBvcmdhbml6YXRpb24gY2hhcmdlZCB3aXRoIG1haW50YWluaW5nIHRoZSBvcmlnaW5hbCBzb3VyY2UgZG9jdW1lbnQgLS0+DQoJPGN1c3RvZGlhbj4NCgkJPGFzc2lnbmVkQ3VzdG9kaWFuPg0KCQkJPHJlcHJlc2VudGVkQ3VzdG9kaWFuT3JnYW5pemF0aW9uPg0KCQkJCTxpZCBleHRlbnNpb249IjMyMUNYIiByb290PSIxLjEuMS4xLjEuMS4xLjEuMyIvPg0KCQkJCTxuYW1lPkdvb2QgSGVhbHRoIEhJRTwvbmFtZT4NCgkJCQk8dGVsZWNvbSB1c2U9IldQIiB2YWx1ZT0idGVsOisxKDU1NSk1NTUtMTAwOSIvPg0KCQkJCTxhZGRyIHVzZT0iV1AiPg0KCQkJCQk8c3RyZWV0QWRkcmVzc0xpbmU+MTAwOSBIZWFsdGhjYXJlIERyaXZlIDwvc3RyZWV0QWRkcmVzc0xpbmU+DQoJCQkJCTxjaXR5PlBvcnRsYW5kPC9jaXR5Pg0KCQkJCQk8c3RhdGU+T1I8L3N0YXRlPg0KCQkJCQk8cG9zdGFsQ29kZT45OTEyMzwvcG9zdGFsQ29kZT4NCgkJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQkJPC9hZGRyPg0KCQkJPC9yZXByZXNlbnRlZEN1c3RvZGlhbk9yZ2FuaXphdGlvbj4NCgkJPC9hc3NpZ25lZEN1c3RvZGlhbj4NCgk8L2N1c3RvZGlhbj4NCgk8IS0tIFRoZSBpbmZvcm1hdGlvblJlY2lwaWVudCByZXByZXNlbnRzIHRoZSBpbnRlbmRlZCByZWNpcGllbnQgb2YgdGhlIGRvY3VtZW50IC0tPg0KCTxpbmZvcm1hdGlvblJlY2lwaWVudD4NCgkJPGludGVuZGVkUmVjaXBpZW50Pg0KCQkJPGluZm9ybWF0aW9uUmVjaXBpZW50Pg0KCQkJCTxuYW1lPg0KCQkJCQk8Z2l2ZW4+U2FyYTwvZ2l2ZW4+DQoJCQkJCTxmYW1pbHk+U3BlY2lhbGl6ZTwvZmFtaWx5Pg0KCQkJCQk8c3VmZml4IHF1YWxpZmllcj0iQUMiPk0uRC48L3N1ZmZpeD4NCgkJCQk8L25hbWU+DQoJCQk8L2luZm9ybWF0aW9uUmVjaXBpZW50Pg0KCQkJPHJlY2VpdmVkT3JnYW5pemF0aW9uPg0KCQkJCTxuYW1lPlRoZSBEb2N0b3JzQXBhcnQgUGh5c2ljaWFuIEdyb3VwPC9uYW1lPg0KCQkJPC9yZWNlaXZlZE9yZ2FuaXphdGlvbj4NCgkJPC9pbnRlbmRlZFJlY2lwaWVudD4NCgk8L2luZm9ybWF0aW9uUmVjaXBpZW50Pg0KCTwhLS0gVGhlIGxlZ2FsQXV0aGVudGljYXRvciByZXByZXNlbnRzIHRoZSBpbmRpdmlkdWFsIHdobyBpcyByZXNwb25zaWJsZSBmb3IgdGhlIGRvY3VtZW50IC0tPg0KCTxsZWdhbEF1dGhlbnRpY2F0b3I+DQoJCTx0aW1lIHZhbHVlPSIyMDE0MTAxNTEwMzAyNi0wNTAwIi8+DQoJCTxzaWduYXR1cmVDb2RlIGNvZGU9IlMiLz4NCgkJPGFzc2lnbmVkRW50aXR5Pg0KCQkJPGlkIGV4dGVuc2lvbj0iNTU1NTU1NTU1NSIgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuNC42Ii8+DQoJCQk8Y29kZSBjb2RlPSIyMDdRQTA1MDVYIiBkaXNwbGF5TmFtZT0iQWR1bHQgTWVkaWNpbmUiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMTAxIiBjb2RlU3lzdGVtTmFtZT0iSGVhbHRoY2FyZSBQcm92aWRlciBUYXhvbm9teSAoSElQQUEpIi8+DQoJCQk8YWRkcj4NCgkJCQk8c3RyZWV0QWRkcmVzc0xpbmU+MTAwNCBIZWFsdGhjYXJlIERyaXZlIDwvc3RyZWV0QWRkcmVzc0xpbmU+DQoJCQkJPGNpdHk+UG9ydGxhbmQ8L2NpdHk+DQoJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQk8cG9zdGFsQ29kZT45OTEyMzwvcG9zdGFsQ29kZT4NCgkJCQk8Y291bnRyeT5VUzwvY291bnRyeT4NCgkJCTwvYWRkcj4NCgkJCTx0ZWxlY29tIHVzZT0iV1AiIHZhbHVlPSJ0ZWw6KzEoNTU1KTU1NS0xMDA0Ii8+DQoJCQk8YXNzaWduZWRQZXJzb24+DQoJCQkJPG5hbWU+DQoJCQkJCTxnaXZlbj5QYXRyaWNpYTwvZ2l2ZW4+DQoJCQkJCTxnaXZlbiBxdWFsaWZpZXI9IkNMIj5QYXR0eTwvZ2l2ZW4+DQoJCQkJCTxmYW1pbHk+UHJpbWFyeTwvZmFtaWx5Pg0KCQkJCQk8c3VmZml4IHF1YWxpZmllcj0iQUMiPk0uRC48L3N1ZmZpeD4NCgkJCQk8L25hbWU+DQoJCQk8L2Fzc2lnbmVkUGVyc29uPg0KCQk8L2Fzc2lnbmVkRW50aXR5Pg0KCTwvbGVnYWxBdXRoZW50aWNhdG9yPg0KCTwhLS0gVGhlIGF1dGhlbnRpY2F0b3IgcmVwcmVzZW50cyB0aGUgaW5kaXZpZHVhbCBhdHRlc3RpbmcgdG8gdGhlIGFjY3VyYWN5IG9mIGluZm9ybWF0aW9uIGluIHRoZSBkb2N1bWVudC0tPg0KCTxhdXRoZW50aWNhdG9yPg0KCQk8dGltZSB2YWx1ZT0iMjAxNDEwMTUxMDMwMjYtMDUwMCIvPg0KCQk8c2lnbmF0dXJlQ29kZSBjb2RlPSJTIi8+DQoJCTxhc3NpZ25lZEVudGl0eT4NCgkJCTxpZCBleHRlbnNpb249IjU1NTU1NTU1NTUiIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjQuNiIvPg0KCQkJPGNvZGUgY29kZT0iMjA3UUEwNTA1WCIgZGlzcGxheU5hbWU9IkFkdWx0IE1lZGljaW5lIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42LjEwMSIgY29kZVN5c3RlbU5hbWU9IkhlYWx0aGNhcmUgUHJvdmlkZXIgVGF4b25vbXkgKEhJUEFBKSIvPg0KCQkJPGFkZHI+DQoJCQkJPHN0cmVldEFkZHJlc3NMaW5lPjEwMDQgSGVhbHRoY2FyZSBEcml2ZSA8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCTxjaXR5PlBvcnRsYW5kPC9jaXR5Pg0KCQkJCTxzdGF0ZT5PUjwvc3RhdGU+DQoJCQkJPHBvc3RhbENvZGU+OTkxMjM8L3Bvc3RhbENvZGU+DQoJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQk8L2FkZHI+DQoJCQk8dGVsZWNvbSB1c2U9IldQIiB2YWx1ZT0idGVsOisxKDU1NSk1NTUtMTAwNCIvPg0KCQkJPGFzc2lnbmVkUGVyc29uPg0KCQkJCTxuYW1lPg0KCQkJCQk8Z2l2ZW4+UGF0cmljaWE8L2dpdmVuPg0KCQkJCQk8Z2l2ZW4gcXVhbGlmaWVyPSJDTCI+UGF0dHk8L2dpdmVuPg0KCQkJCQk8ZmFtaWx5PlByaW1hcnk8L2ZhbWlseT4NCgkJCQkJPHN1ZmZpeCBxdWFsaWZpZXI9IkFDIj5NLkQuPC9zdWZmaXg+DQoJCQkJPC9uYW1lPg0KCQkJPC9hc3NpZ25lZFBlcnNvbj4NCgkJPC9hc3NpZ25lZEVudGl0eT4NCgk8L2F1dGhlbnRpY2F0b3I+DQoJPCEtLSBUaGUgcGFydGljaXBhbnQgcmVwcmVzZW50cyBzdXBwb3J0aW5nIGVudGl0aWVzIC0tPg0KCTxwYXJ0aWNpcGFudCB0eXBlQ29kZT0iSU5EIj4NCgkJPCEtLSB0eXBlQ29kZSAiSU5EIiByZXByZXNlbnRzIGFuIGluZGl2aWR1YWwgLS0+DQoJCTxhc3NvY2lhdGVkRW50aXR5IGNsYXNzQ29kZT0iTk9LIj4NCgkJCTwhLS0gY2xhc3NDb2RlICJOT0siIHJlcHJlc2VudHMgdGhlIHBhdGllbnQncyBuZXh0IG9mIGtpbi0tPg0KCQkJPGFkZHIgdXNlPSJIUCI+DQoJCQkJPHN0cmVldEFkZHJlc3NMaW5lPjIyMjIgSG9tZSBTdHJlZXQ8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCTxjaXR5PkJlYXZlcnRvbjwvY2l0eT4NCgkJCQk8c3RhdGU+T1I8L3N0YXRlPg0KCQkJCTxwb3N0YWxDb2RlPjk3ODY3PC9wb3N0YWxDb2RlPg0KCQkJCTxjb3VudHJ5PlVTPC9jb3VudHJ5Pg0KCQkJPC9hZGRyPg0KCQkJPHRlbGVjb20gdmFsdWU9InRlbDorMSg1NTUpNTU1LTIwMDgiIHVzZT0iTUMiLz4NCgkJCTxhc3NvY2lhdGVkUGVyc29uPg0KCQkJCTxuYW1lPg0KCQkJCQk8Z2l2ZW4+Qm9yaXM8L2dpdmVuPg0KCQkJCQk8Z2l2ZW4gcXVhbGlmaWVyPSJDTCI+Qm88L2dpdmVuPg0KCQkJCQk8ZmFtaWx5PkpvbmVzPC9mYW1pbHk+DQoJCQkJPC9uYW1lPg0KCQkJPC9hc3NvY2lhdGVkUGVyc29uPg0KCQk8L2Fzc29jaWF0ZWRFbnRpdHk+DQoJPC9wYXJ0aWNpcGFudD4NCgk8IS0tIEVudGl0aWVzIHBsYXlpbmcgbXVsdGlwbGUgcm9sZXMgYXJlIHJlY29yZGVkIGluIG11bHRpcGxlIHBhcnRpY2lwYW50cyAtLT4NCgk8cGFydGljaXBhbnQgdHlwZUNvZGU9IklORCI+DQoJCTxhc3NvY2lhdGVkRW50aXR5IGNsYXNzQ29kZT0iRUNPTiI+DQoJCQk8IS0tIGNsYXNzQ29kZSAiRUNPTiIgcmVwcmVzZW50cyBhbiBlbWVyZ2VuY3kgY29udGFjdCAtLT4NCgkJCTxhZGRyIHVzZT0iSFAiPg0KCQkJCTxzdHJlZXRBZGRyZXNzTGluZT4yMjIyIEhvbWUgU3RyZWV0PC9zdHJlZXRBZGRyZXNzTGluZT4NCgkJCQk8Y2l0eT5CZWF2ZXJ0b248L2NpdHk+DQoJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQk8cG9zdGFsQ29kZT45Nzg2NzwvcG9zdGFsQ29kZT4NCgkJCQk8Y291bnRyeT5VUzwvY291bnRyeT4NCgkJCTwvYWRkcj4NCgkJCTx0ZWxlY29tIHZhbHVlPSJ0ZWw6KzEoNTU1KTU1NS0yMDA4IiB1c2U9Ik1DIi8+DQoJCQk8YXNzb2NpYXRlZFBlcnNvbj4NCgkJCQk8bmFtZT4NCgkJCQkJPGdpdmVuPkJvcmlzPC9naXZlbj4NCgkJCQkJPGdpdmVuIHF1YWxpZmllcj0iQ0wiPkJvPC9naXZlbj4NCgkJCQkJPGZhbWlseT5Kb25lczwvZmFtaWx5Pg0KCQkJCTwvbmFtZT4NCgkJCTwvYXNzb2NpYXRlZFBlcnNvbj4NCgkJPC9hc3NvY2lhdGVkRW50aXR5Pg0KCTwvcGFydGljaXBhbnQ+DQoJPGRvY3VtZW50YXRpb25PZj4NCgkJPHNlcnZpY2VFdmVudCBjbGFzc0NvZGU9IlBDUFIiPg0KCQkJPCEtLSBUaGUgZWZmZWN0aXZlVGltZSByZWZsZWN0cyB0aGUgcHJvdmlzaW9uIG9mIGNhcmUgc3VtbWFyaXplZCBpbiB0aGUgZG9jdW1lbnQuIA0KCQkJCUluIHRoaXMgc2NlbmFyaW8sIHRoZSBwcm92aXNpb24gb2YgY2FyZSBzdW1tYXJpemVkIGlzIGRhdGUgd2hlbiBwYXRpZW50IGZpcnN0IHNlZW4gLS0+DQoJCQk8ZWZmZWN0aXZlVGltZT4NCgkJCQk8bG93IHZhbHVlPSIyMDE0MTAwMSIvPg0KCQkJCTwhLS0gVGhlIGxvdyB2YWx1ZSByZXByZXNlbnRzIHdoZW4gdGhlIHN1bW1hcml6ZWQgcHJvdmlzaW9uIG9mIGNhcmUgYmVnYW4uIA0KCQkJCQlJbiB0aGlzIHNjZW5hcmlvLCB0aGUgcGF0aWVudCdzIGZpcnN0IHZpc2l0IC0tPg0KCQkJCTxoaWdoIHZhbHVlPSIyMDE0MTAxNTEwMzAyNi0wNTAwIi8+DQoJCQkJPCEtLSBUaGUgaGlnaCB2YWx1ZSByZXByZXNlbnRzIHdoZW4gdGhlIHN1bW1hcml6ZWQgcHJvdmlzaW9uIG9mIGNhcmUgYmVpbmcgZW5kZWQuIA0KCQkJCQlJbiB0aGlzIHNjZW5hcmlvLCB3aGVuIGNoYXJ0IHN1bW1hcnkgd2FzIGNyZWF0ZWQgLS0+DQoJCQk8L2VmZmVjdGl2ZVRpbWU+DQoJCQk8cGVyZm9ybWVyIHR5cGVDb2RlPSJQUkYiPg0KCQkJCTxmdW5jdGlvbkNvZGUgY29kZT0iUENQIiBkaXNwbGF5TmFtZT0iUHJpbWFyeSBDYXJlIFByb3ZpZGVyIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My41Ljg4IiBjb2RlU3lzdGVtTmFtZT0iUGFydGljaXBhdGlvbiBGdW5jdGlvbiI+DQoJCQkJCTxvcmlnaW5hbFRleHQ+UHJpbWFyeSBDYXJlIFByb3ZpZGVyPC9vcmlnaW5hbFRleHQ+DQoJCQkJPC9mdW5jdGlvbkNvZGU+DQoJCQkJPGFzc2lnbmVkRW50aXR5Pg0KCQkJCQk8aWQgZXh0ZW5zaW9uPSI1NTU1NTU1NTU1IiByb290PSIyLjE2Ljg0MC4xLjExMzg4My40LjYiLz4NCgkJCQkJPGNvZGUgY29kZT0iMjA3UUEwNTA1WCIgZGlzcGxheU5hbWU9IkFkdWx0IE1lZGljaW5lIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42LjEwMSIgY29kZVN5c3RlbU5hbWU9IkhlYWx0aGNhcmUgUHJvdmlkZXIgVGF4b25vbXkgKEhJUEFBKSIvPg0KCQkJCQk8YWRkcj4NCgkJCQkJCTxzdHJlZXRBZGRyZXNzTGluZT4xMDA0IEhlYWx0aGNhcmUgRHJpdmUgPC9zdHJlZXRBZGRyZXNzTGluZT4NCgkJCQkJCTxjaXR5PlBvcnRsYW5kPC9jaXR5Pg0KCQkJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQkJCTxwb3N0YWxDb2RlPjk5MTIzPC9wb3N0YWxDb2RlPg0KCQkJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQkJCTwvYWRkcj4NCgkJCQkJPHRlbGVjb20gdXNlPSJXUCIgdmFsdWU9InRlbDorMSg1NTUpNTU1LTEwMDQiLz4NCgkJCQkJPGFzc2lnbmVkUGVyc29uPg0KCQkJCQkJPG5hbWU+DQoJCQkJCQkJPGdpdmVuPlBhdHJpY2lhPC9naXZlbj4NCgkJCQkJCQk8Z2l2ZW4gcXVhbGlmaWVyPSJDTCI+UGF0dHk8L2dpdmVuPg0KCQkJCQkJCTxmYW1pbHk+UHJpbWFyeTwvZmFtaWx5Pg0KCQkJCQkJCTxzdWZmaXggcXVhbGlmaWVyPSJBQyI+TS5ELjwvc3VmZml4Pg0KCQkJCQkJPC9uYW1lPg0KCQkJCQk8L2Fzc2lnbmVkUGVyc29uPg0KCQkJCQk8cmVwcmVzZW50ZWRPcmdhbml6YXRpb24+DQoJCQkJCQk8aWQgZXh0ZW5zaW9uPSIyMTlCWCIgcm9vdD0iMS4xLjEuMS4xLjEuMS4xLjIiLz4NCgkJCQkJCTxuYW1lPlRoZSBEb2N0b3JzVG9nZXRoZXIgUGh5c2ljaWFuIEdyb3VwPC9uYW1lPg0KCQkJCQkJPHRlbGVjb20gdXNlPSJXUCIgdmFsdWU9InRlbDogKzEoNTU1KTU1NS01MDAwIi8+DQoJCQkJCQk8YWRkcj4NCgkJCQkJCQk8c3RyZWV0QWRkcmVzc0xpbmU+MTAwNCBIZWFsdGggRHJpdmU8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCQkJCTxjaXR5PlBvcnRsYW5kPC9jaXR5Pg0KCQkJCQkJCTxzdGF0ZT5PUjwvc3RhdGU+DQoJCQkJCQkJPHBvc3RhbENvZGU+OTkxMjM8L3Bvc3RhbENvZGU+DQoJCQkJCQkJPGNvdW50cnk+VVM8L2NvdW50cnk+DQoJCQkJCQk8L2FkZHI+DQoJCQkJCTwvcmVwcmVzZW50ZWRPcmdhbml6YXRpb24+DQoJCQkJPC9hc3NpZ25lZEVudGl0eT4NCgkJCTwvcGVyZm9ybWVyPg0KCQk8L3NlcnZpY2VFdmVudD4NCgk8L2RvY3VtZW50YXRpb25PZj4NCgk8IS0tICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqIENEQSBCb2R5ICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqIC0tPg0KCTxjb21wb25lbnQ+DQoJCTxzdHJ1Y3R1cmVkQm9keT4NCgkJCTwhLS0gKioqKioqKioqKioqKioqKiogQUxMRVJHSUVTICoqKioqKioqKioqKioqKiAtLT4NCgkJCTxjb21wb25lbnQ+DQoJCQkJPHNlY3Rpb24+DQoJCQkJCTwhLS0gKioqIEFsbGVyZ2llcyBhbmQgSW50b2xlcmFuY2VzIHNlY3Rpb24gd2l0aCBlbnRyaWVzIHJlcXVpcmVkICoqKiAtLT4NCgkJCQkJPCEtLSBUaGlzIHNlY3Rpb24gcmVwcmVzZW50cyB0aGUgc3RhdGVtZW50IG9mICJubyBrbm93biBhbGxlcmdpZXMiIC0tPg0KCQkJCQk8IS0tIElmIHlvdSB3YW50IHRvIHJlcHJlc2VudCBhIG1vcmUgZ2VuZXJhbGl6ZWQgJ25vIGluZm9ybWF0aW9uJywgc2VlIG51bGwgc2VjdGlvbiBwYXR0ZXJuIChlLmcuIHRoaXMgQ0NEIG1lZGljYXRpb25zIGFuZCBwcm9ibGVtcyktLT4NCgkJCQkJPCEtLSBJZiB5b3Ugb25seSB3YW50ZWQgdG8gcmVwcmVzZW50ICdubyBrbm93biBkcnVnIGFsbGVyZ2llcycsIHRoZSBvYnNlcnZhdGlvbi92YWx1ZUBjb2RlIGFuZCBwYXJ0aWNpcGFudCBzaG91bGQgYmUgY2hhbmdlZCBhY2NvcmRpbmdseSAtLT4NCgkJCQkJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuMi42LjEiIGV4dGVuc2lvbj0iMjAxNC0wNi0wOSIvPg0KCQkJCQk8Y29kZSBjb2RlPSI0ODc2NS0yIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42LjEiLz4NCgkJCQkJPHRpdGxlPkFMTEVSR0lFUyBBTkQgQURWRVJTRSBSRUFDVElPTlM8L3RpdGxlPg0KCQkJCQk8dGV4dD4NCgkJCQkJCTxwYXJhZ3JhcGg+Tm8ga25vd24gYWxsZXJnaWVzPC9wYXJhZ3JhcGg+DQoJCQkJCTwvdGV4dD4NCgkJCQkJPGVudHJ5IHR5cGVDb2RlPSJEUklWIj4NCgkJCQkJCTwhLS0gQWxsZXJneSBDb25jZXJuIEFjdCAtLT4NCgkJCQkJCTxhY3QgY2xhc3NDb2RlPSJBQ1QiIG1vb2RDb2RlPSJFVk4iPg0KCQkJCQkJCTx0ZW1wbGF0ZUlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjEwLjIwLjIyLjQuMzAiIGV4dGVuc2lvbj0iMjAxNC0wNi0wOSIvPg0KCQkJCQkJCTxpZCByb290PSIzNmUzZTkzMC03YjE0LTExZGItOWZlMS0wODAwMjAwYzlhNjYiLz4NCgkJCQkJCQk8IS0tIFNEV0cgc3VwcG9ydHMgNDg3NjUtMiBvciBDT05DIGluIHRoZSBjb2RlIGVsZW1lbnQgLS0+DQoJCQkJCQkJPGNvZGUgY29kZT0iQ09OQyIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNS42Ii8+DQoJCQkJCQkJPCEtLWN1cnJlbnRseSB0cmFja2VkIGNvbmNlcm5zIGFyZSBhY3RpdmUgY29uY2VybnMtLT4NCgkJCQkJCQk8c3RhdHVzQ29kZSBjb2RlPSJhY3RpdmUiLz4NCgkJCQkJCQk8ZWZmZWN0aXZlVGltZT4NCgkJCQkJCQkJPCEtLSBUaGlzIGVxdWF0ZXMgdG8gdGhlIHRpbWUgdGhlIGNvbmNlcm4gd2FzIGF1dGhvcmVkIGluIHRoZSBwYXRpZW50J3MgY2hhcnQuIFRoaXMgbWF5IGZyZXF1ZW50bHkgYmUgYW4gRUhSIHRpbWVzdGFtcC0tPg0KCQkJCQkJCQk8bG93IHZhbHVlPSIyMDE0MTAwMzEwMzAyNi0wNTAwIi8+DQoJCQkJCQkJPC9lZmZlY3RpdmVUaW1lPg0KCQkJCQkJCTxlbnRyeVJlbGF0aW9uc2hpcCB0eXBlQ29kZT0iU1VCSiI+DQoJCQkJCQkJCTwhLS0gTm8gS25vd24gQWxsZXJnaWVzIC0tPg0KCQkJCQkJCQk8IS0tIFRoZSBuZWdhdGlvbkluZCA9IHRydWUgbmVnYXRlcyB0aGUgb2JzZXJ2YXRpb24vdmFsdWUgLS0+DQoJCQkJCQkJCTwhLS0gVGhlIHVzZSBvZiBuZWdhdGlvbkluZCBjb3JyZXNwb25kcyB3aXRoIHRoZSBuZXdlciBPYnNlcnZhdGlvbi52YWx1ZU5lZ2F0aW9uSW5kIC0tPg0KCQkJCQkJCQk8b2JzZXJ2YXRpb24gY2xhc3NDb2RlPSJPQlMiIG1vb2RDb2RlPSJFVk4iIG5lZ2F0aW9uSW5kPSJ0cnVlIj4NCgkJCQkJCQkJCTwhLS0gYWxsZXJneSAtIGludG9sZXJhbmNlIG9ic2VydmF0aW9uIHRlbXBsYXRlIC0tPg0KCQkJCQkJCQkJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuNC43IiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgkJCQkJCQkJCTxpZCByb290PSI0YWRjMTAyMC03YjE0LTExZGItOWZlMS0wODAwMjAwYzlhNjYiLz4NCgkJCQkJCQkJCTxjb2RlIGNvZGU9IkFTU0VSVElPTiIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNS40Ii8+DQoJCQkJCQkJCQk8c3RhdHVzQ29kZSBjb2RlPSJjb21wbGV0ZWQiLz4NCgkJCQkJCQkJCTwhLS0gTi9BIC0gSW4gdGhpcyBjYXNlLCBubyBiaW9sb2dpY2FsIG9uc2V0IGlzIGRvY3VtZW50ZWQgZm9yIHRoZSBhYnNlbmNlIG9mIGFsbGVyZ2llcyAtLT4NCgkJCQkJCQkJCTxlZmZlY3RpdmVUaW1lPg0KCQkJCQkJCQkJCTxsb3cgbnVsbEZsYXZvcj0iTkEiLz4NCgkJCQkJCQkJCTwvZWZmZWN0aXZlVGltZT4NCgkJCQkJCQkJCTwhLS0gVGhpcyBjb2RlIHdhcyBzZWxlY3RlZCB0byBuZWdhdGUgYW55IGFsbGVyZ3kuIEZvciBubyBrbm93biBkcnVnIGFsbGVyZ2llcywgY29kZSA0MTYwOTgwMDIgd291bGQgYmUgbW9yZSBhcHByb3ByaWF0ZSAtLT4NCgkJCQkJCQkJCTx2YWx1ZSB4c2k6dHlwZT0iQ0QiIGNvZGU9IjQxOTE5OTAwNyIgZGlzcGxheU5hbWU9IkFsbGVyZ3kgdG8gc3Vic3RhbmNlIChkaXNvcmRlcikiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuOTYiIGNvZGVTeXN0ZW1OYW1lPSJTTk9NRUQgQ1QiLz4NCgkJCQkJCQkJCTxhdXRob3I+DQoJCQkJCQkJCQkJPHRpbWUgdmFsdWU9IjIwMTQxMDAzMTAzMDI2LTA1MDAiLz4NCgkJCQkJCQkJCQk8YXNzaWduZWRBdXRob3I+DQoJCQkJCQkJCQkJCTxpZCBleHRlbnNpb249Ijk5OTk5OTk5IiByb290PSIyLjE2Ljg0MC4xLjExMzg4My40LjYiLz4NCgkJCQkJCQkJCQkJPGNvZGUgY29kZT0iMjAwMDAwMDAwWCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xMDEiIGRpc3BsYXlOYW1lPSJBbGxvcGF0aGljICZhbXA7IE9zdGVvcGF0aGljIFBoeXNpY2lhbnMiLz4NCgkJCQkJCQkJCQkJPHRlbGVjb20gdXNlPSJXUCIgdmFsdWU9InRlbDo1NTUtNTU1LTEwMDIiLz4NCgkJCQkJCQkJCQkJPGFzc2lnbmVkUGVyc29uPg0KCQkJCQkJCQkJCQkJPG5hbWU+DQoJCQkJCQkJCQkJCQkJPGdpdmVuPkhlbnJ5PC9naXZlbj4NCgkJCQkJCQkJCQkJCQk8ZmFtaWx5PlNldmVuPC9mYW1pbHk+DQoJCQkJCQkJCQkJCQk8L25hbWU+DQoJCQkJCQkJCQkJCTwvYXNzaWduZWRQZXJzb24+DQoJCQkJCQkJCQkJPC9hc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCTwvYXV0aG9yPg0KCQkJCQkJCQkJPCEtLSBJU1NVRSBwYXJ0aWNpcGFudCBpcyByZXF1aXJlZCBmb3IgYWxsZXJneSBpbnRvbGVyYW5jZSBldmVuIHdoZW4gbmVnYXRlZCAtLT4NCgkJCQkJCQkJCTxwYXJ0aWNpcGFudCB0eXBlQ29kZT0iQ1NNIj4NCgkJCQkJCQkJCQk8cGFydGljaXBhbnRSb2xlIGNsYXNzQ29kZT0iTUFOVSI+DQoJCQkJCQkJCQkJCTxwbGF5aW5nRW50aXR5IGNsYXNzQ29kZT0iTU1BVCI+DQoJCQkJCQkJCQkJCQk8IS0tIElTU1VFIFRoaXMgY29uZmxpY3RzIHdpdGggZ3VpZGFuY2UgZnJvbSBDREEgZXhhbXBsZSB0YXNrIGZvcmNlIC0tPg0KCQkJCQkJCQkJCQkJPCEtLSBDb2RlIDQxMDk0MjAwNyB3b3VsZCBiZSBhcHByb3ByaWF0ZSBmb3Igbm8ga25vd24gZHJ1ZyBhbGxlcmd5IC0tPg0KCQkJCQkJCQkJCQkJPGNvZGUgY29kZT0iMTA1NTkwMDAxIiBkaXNwbGF5TmFtZT0iU3Vic3RhbmNlIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42Ljk2IiBjb2RlU3lzdGVtTmFtZT0iU05PTUVEIENUIi8+DQoJCQkJCQkJCQkJCTwvcGxheWluZ0VudGl0eT4NCgkJCQkJCQkJCQk8L3BhcnRpY2lwYW50Um9sZT4NCgkJCQkJCQkJCTwvcGFydGljaXBhbnQ+DQoJCQkJCQkJCTwvb2JzZXJ2YXRpb24+DQoJCQkJCQkJPC9lbnRyeVJlbGF0aW9uc2hpcD4NCgkJCQkJCTwvYWN0Pg0KCQkJCQk8L2VudHJ5Pg0KCQkJCTwvc2VjdGlvbj4NCgkJCTwvY29tcG9uZW50Pg0KCQkJPCEtLSAqKioqKioqKioqKioqKioqIE1FRElDQVRJT05TICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqIC0tPg0KCQkJPGNvbXBvbmVudD4NCgkJCQk8IS0tIG51bGxGbGF2b3Igb2YgTkkgaW5kaWNhdGVzIE5vIEluZm9ybWF0aW9uLi0tPg0KCQkJCTwhLS0gTm90ZSB0aGlzIHBhdHRlcm4gbWF5IG5vdCB2YWxpZGF0ZSB3aXRoIHNjaGVtYXRyb24gYnV0IGhhcyBiZWVuIFNEV0cgYXBwcm92ZWQgLS0+DQoJCQkJPHNlY3Rpb24gbnVsbEZsYXZvcj0iTkkiPg0KCQkJCQk8IS0tICoqKiBNZWRpY2F0aW9ucyBzZWN0aW9uIHdpdGggZW50cmllcyByZXF1aXJlZCAqKiogLS0+DQoJCQkJCTx0ZW1wbGF0ZUlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjEwLjIwLjIyLjIuMS4xIiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgkJCQkJPGNvZGUgY29kZT0iMTAxNjAtMCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xIiBjb2RlU3lzdGVtTmFtZT0iTE9JTkMiIGRpc3BsYXlOYW1lPSJISVNUT1JZIE9GIE1FRElDQVRJT04gVVNFIi8+DQoJCQkJCTx0aXRsZT5NRURJQ0FUSU9OUzwvdGl0bGU+DQoJCQkJCTx0ZXh0Pg0KCQkJCQkJPHBhcmFncmFwaD5ObyBpbmZvcm1hdGlvbjwvcGFyYWdyYXBoPg0KCQkJCQk8L3RleHQ+DQoJCQkJPC9zZWN0aW9uPg0KCQkJPC9jb21wb25lbnQ+DQoJCQk8IS0tICoqKioqKioqKioqKioqKioqIFBST0JMRU0gTElTVCAqKioqKioqKioqKioqKioqKioqKioqKiAtLT4NCgkJCTxjb21wb25lbnQ+DQoJCQkJPCEtLSBudWxsRmxhdm9yIG9mIE5JIGluZGljYXRlcyBObyBJbmZvcm1hdGlvbi4tLT4NCgkJCQk8IS0tIE5vdGUgdGhpcyBwYXR0ZXJuIG1heSBub3QgdmFsaWRhdGUgd2l0aCBzY2hlbWF0cm9uIGJ1dCBoYXMgYmVlbiBTRFdHIGFwcHJvdmVkIC0tPg0KCQkJCTxzZWN0aW9uIG51bGxGbGF2b3I9Ik5JIj4NCgkJCQkJPCEtLSBjb25mb3JtcyB0byBQcm9ibGVtcyBzZWN0aW9uIHdpdGggZW50cmllcyByZXF1aXJlZCAtLT4NCgkJCQkJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuMi41LjEiIGV4dGVuc2lvbj0iMjAxNC0wNi0wOSIvPg0KCQkJCQk8Y29kZSBjb2RlPSIxMTQ1MC00IiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42LjEiIGNvZGVTeXN0ZW1OYW1lPSJMT0lOQyIgZGlzcGxheU5hbWU9IlBST0JMRU0gTElTVCIvPg0KCQkJCQk8dGl0bGU+UFJPQkxFTVM8L3RpdGxlPg0KCQkJCQk8dGV4dD5ObyBJbmZvcm1hdGlvbjwvdGV4dD4NCgkJCQk8L3NlY3Rpb24+DQoJCQk8L2NvbXBvbmVudD4NCgkJCTwhLS0gKioqKioqKioqKioqKiogUFJPQ0VEVVJFUyAqKioqKioqKioqKioqKioqKiAtLT4NCgkJCTxjb21wb25lbnQ+DQoJCQkJPHNlY3Rpb24+DQoJCQkJCTx0ZW1wbGF0ZUlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjEwLjIwLjIyLjIuNy4xIiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgkJCQkJPGNvZGUgY29kZT0iNDc1MTktNCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xIiBjb2RlU3lzdGVtTmFtZT0iTE9JTkMiIGRpc3BsYXlOYW1lPSJISVNUT1JZIE9GIFBST0NFRFVSRVMiLz4NCgkJCQkJPHRpdGxlPlBST0NFRFVSRVM8L3RpdGxlPg0KCQkJCQk8dGV4dD4NCgkJCQkJCTx0YWJsZT4NCgkJCQkJCQk8dGhlYWQ+DQoJCQkJCQkJCTx0cj4NCgkJCQkJCQkJCTx0aD5EZXNjcmlwdGlvbjwvdGg+DQoJCQkJCQkJCQk8dGg+RGF0ZSBhbmQgVGltZSAoUmFuZ2UpPC90aD4NCgkJCQkJCQkJCTx0aD5TdGF0dXM8L3RoPg0KCQkJCQkJCQk8L3RyPg0KCQkJCQkJCTwvdGhlYWQ+DQoJCQkJCQkJPHRib2R5Pg0KCQkJCQkJCQk8dHIgSUQ9IlByb2NlZHVyZTEiPg0KCQkJCQkJCQkJPHRkIElEPSJQcm9jZWR1cmVEZXNjMSI+TGFwYXJvc2NvcGljIGFwcGVuZGVjdG9teTwvdGQ+DQoJCQkJCQkJCQk8dGQ+MDMgRmViIDIwMTQgMDk6MjJhbS0gMDMgRmViIDIwMTQgMTE6MTVhbTwvdGQ+DQoJCQkJCQkJCQk8dGQ+Q29tcGxldGVkPC90ZD4NCgkJCQkJCQkJPC90cj4NCgkJCQkJCQkJPHRyIElEPSJQcm9jZWR1cmUyIj4NCgkJCQkJCQkJCTx0ZCBJRD0iUHJvY2VkdXJlRGVzYzIiPkVsZWN0cm9jYXJkaW9ncmFtICgxMi1MZWFkKTwvdGQ+DQoJCQkJCQkJCQk8dGQ+MjkgTWFyIDIwMTQgMDk6MTVhbTwvdGQ+DQoJCQkJCQkJCQk8dGQ+Q29tcGxldGVkPC90ZD4NCgkJCQkJCQkJPC90cj4NCgkJCQkJCQkJPHRyIElEPSJQcm9jZWR1cmUzIj4NCgkJCQkJCQkJCTx0ZCBJRD0iUHJvY2VkdXJlRGVzYzMiPkluZGl2aWR1YWwgQ291bnNlbGluZyBGb3IgTWVkaWNhbCBOdXRyaXRpb24gPC90ZD4NCgkJCQkJCQkJCTx0ZD4yOSBNYXIgMjAxNCAxMDo0NWFtPC90ZD4NCgkJCQkJCQkJCTx0ZD5Db21wbGV0ZWQ8L3RkPg0KCQkJCQkJCQk8L3RyPg0KCQkJCQkJCTwvdGJvZHk+DQoJCQkJCQk8L3RhYmxlPg0KCQkJCQk8L3RleHQ+DQoJCQkJCTxlbnRyeSB0eXBlQ29kZT0iRFJJViI+DQoJCQkJCQk8IS0tIFByb2NlZHVyZXMgc2hvdWxkIGJlIHVzZWQgZm9yIGNhcmUgdGhhdCBkaXJlY3RseSBjaGFuZ2VzIHRoZSBwYXRpZW50J3MgcGh5c2ljYWwgc3RhdGUuLS0+DQoJCQkJCQk8cHJvY2VkdXJlIG1vb2RDb2RlPSJFVk4iIGNsYXNzQ29kZT0iUFJPQyI+DQoJCQkJCQkJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuNC4xNCIgZXh0ZW5zaW9uPSIyMDE0LTA2LTA5Ii8+DQoJCQkJCQkJPGlkIHJvb3Q9IjY0YWYyNmQ1LTg4ZWYtNDE2OS1iYTE2LWM2ZWYxNmExODI0ZiIvPg0KCQkJCQkJCTxjb2RlIHhzaTp0eXBlPSJDRSIgY29kZT0iNjAyNTAwNyIgZGlzcGxheU5hbWU9IkxhcGFyb3Njb3BpYyBhcHBlbmRlY3RvbXkiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuOTYiIGNvZGVTeXN0ZW1OYW1lPSJTTk9NRUQtQ1QiPg0KCQkJCQkJCQk8b3JpZ2luYWxUZXh0PiBMYXBhcm9zY29waWMgYXBwZW5kZWN0b215PHJlZmVyZW5jZSB2YWx1ZT0iI1Byb2NlZHVyZURlc2MxIi8+DQoJCQkJCQkJCTwvb3JpZ2luYWxUZXh0Pg0KCQkJCQkJCQk8dHJhbnNsYXRpb24geHNpOnR5cGU9IkNFIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42LjEyIiBjb2RlU3lzdGVtTmFtZT0iQ1BUIiBjb2RlPSI0NDk3MCIgZGlzcGxheU5hbWU9IkxhcGFyb3Njb3BpYyBBcHBlbmRlY3RvbXkiLz4NCgkJCQkJCQkJPHRyYW5zbGF0aW9uIHhzaTp0eXBlPSJDRSIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi40IiBjb2RlU3lzdGVtTmFtZT0iSUNELTEwLVBDUyIgY29kZT0iMERUSjRaWiIgZGlzcGxheU5hbWU9IlJlc2VjdGlvbiBvZiBBcHBlbmRpeCwgUGVyY3V0YW5lb3VzIEVuZG9zY29waWMgQXBwcm9hY2giLz4NCgkJCQkJCQkJPHRyYW5zbGF0aW9uIHhzaTp0eXBlPSJDRSIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xMDQiIGNvZGVTeXN0ZW1OYW1lPSJJQ0QtOS1DTSIgY29kZT0iNDcuMDEiIGRpc3BsYXlOYW1lPSJMYXBhcm9zY29waWMgYXBwZW5kZWN0b215Ii8+DQoJCQkJCQkJPC9jb2RlPg0KCQkJCQkJCTx0ZXh0Pg0KCQkJCQkJCQk8cmVmZXJlbmNlIHZhbHVlPSIjUHJvY2VkdXJlMSIvPg0KCQkJCQkJCTwvdGV4dD4NCgkJCQkJCQk8c3RhdHVzQ29kZSBjb2RlPSJjb21wbGV0ZWQiLz4NCgkJCQkJCQk8IS0tIEVmZmVjdGl2ZSB0aW1lcyBjYW4gYmUgZWl0aGVyIGEgdmFsdWUgb3IgaW50ZXJ2YWwuIEZvciBwcm9jZWR1cmVzIHdpdGggc3RhcnQgYW5kIHN0b3AgdGltZXMsIGFuIGludGVydmFsIHdvdWxkIGJlIG1vcmUgYXBwcm9wcmlhdGUgLS0+DQoJCQkJCQkJPGVmZmVjdGl2ZVRpbWUgeHNpOnR5cGU9IklWTF9UUyI+DQoJCQkJCQkJCTxsb3cgdmFsdWU9IjIwMTQxMDAyMTAzMDI2LTA1MDAiLz4NCgkJCQkJCQkJPGhpZ2ggdmFsdWU9IjIwMTQxMDAyMTI0MjQ1LTA1MDAiLz4NCgkJCQkJCQk8L2VmZmVjdGl2ZVRpbWU+DQoJCQkJCQkJPCEtLSBtZXRob2RDb2RlIGluZGljYXRlcyBob3cgdGhlIHByb2NlZHVyZSB3YXMgcGVyZm9ybWVkLiBJdCBjYW5ub3QgY29uZmxpY3Qgd2l0aCB0aGUgY29kZSB1c2VkIGZvciBwcm9jZWR1cmUtLT4NCgkJCQkJCQk8bWV0aG9kQ29kZSBjb2RlPSI1MTMxNjAwOSIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi45NiIgZGlzcGxheU5hbWU9IkxhcGFyb3Njb3BpYyBwcm9jZWR1cmUiIGNvZGVTeXN0ZW1OYW1lPSJTTk9NRUQtQ1QiLz4NCgkJCQkJCQk8IS0tIHRhcmdldFNpdGVDb2RlIGluZGljYXRlcyB0aGUgYm9keSBzaXRlIGFkZHJlc3NlZCBieSBwcm9jZWR1cmUgYW5kIG11c3QgYmUgZnJvbSB2YWx1ZSBzZXQgMi4xNi44NDAuMS4xMTM4ODMuMy44OC4xMi4zMjIxLjguOS0tPg0KCQkJCQkJCTx0YXJnZXRTaXRlQ29kZSBjb2RlPSIxODEyNTUwMDAiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuOTYiIGRpc3BsYXlOYW1lPSJFbnRpcmUgQXBwZW5kaXgiIGNvZGVTeXN0ZW1OYW1lPSJTTk9NRUQtQ1QiLz4NCgkJCQkJCQk8cGVyZm9ybWVyPg0KCQkJCQkJCQk8YXNzaWduZWRFbnRpdHk+DQoJCQkJCQkJCQk8aWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTkuNS45OTk5LjQ1NiIgZXh0ZW5zaW9uPSIyOTgxODIzIi8+DQoJCQkJCQkJCQk8YWRkcj4NCgkJCQkJCQkJCQk8c3RyZWV0QWRkcmVzc0xpbmU+MTAwMSBWaWxsYWdlIEF2ZW51ZTwvc3RyZWV0QWRkcmVzc0xpbmU+DQoJCQkJCQkJCQkJPGNpdHk+UG9ydGxhbmQ8L2NpdHk+DQoJCQkJCQkJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQkJCQkJCQk8cG9zdGFsQ29kZT45OTEyMzwvcG9zdGFsQ29kZT4NCgkJCQkJCQkJCQk8Y291bnRyeT5VUzwvY291bnRyeT4NCgkJCQkJCQkJCTwvYWRkcj4NCgkJCQkJCQkJCTx0ZWxlY29tIHVzZT0iV1AiIHZhbHVlPSIrMSg1NTUpNTU1LTUwMDAiLz4NCgkJCQkJCQkJCTxyZXByZXNlbnRlZE9yZ2FuaXphdGlvbiBjbGFzc0NvZGU9Ik9SRyI+DQoJCQkJCQkJCQkJPGlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjE5LjUuOTk5OS4xMzkzIi8+DQoJCQkJCQkJCQkJPG5hbWU+Q29tbXVuaXR5IEhlYWx0aCBhbmQgSG9zcGl0YWxzPC9uYW1lPg0KCQkJCQkJCQkJCTx0ZWxlY29tIHVzZT0iV1AiIHZhbHVlPSIrMSg1NTUpNTU1LTUwMDAiLz4NCgkJCQkJCQkJCQk8YWRkcj4NCgkJCQkJCQkJCQkJPHN0cmVldEFkZHJlc3NMaW5lPjEwMDEgVmlsbGFnZSBBdmVudWU8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCQkJCQkJCQk8Y2l0eT5Qb3J0bGFuZDwvY2l0eT4NCgkJCQkJCQkJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQkJCQkJCQkJPHBvc3RhbENvZGU+OTkxMjM8L3Bvc3RhbENvZGU+DQoJCQkJCQkJCQkJCTxjb3VudHJ5PlVTPC9jb3VudHJ5Pg0KCQkJCQkJCQkJCTwvYWRkcj4NCgkJCQkJCQkJCTwvcmVwcmVzZW50ZWRPcmdhbml6YXRpb24+DQoJCQkJCQkJCTwvYXNzaWduZWRFbnRpdHk+DQoJCQkJCQkJPC9wZXJmb3JtZXI+DQoJCQkJCQk8L3Byb2NlZHVyZT4NCgkJCQkJPC9lbnRyeT4NCgkJCQkJPGVudHJ5IHR5cGVDb2RlPSJEUklWIj4NCgkJCQkJCTwhLS0gT2JzZXJ2YXRpb25zIHNob3VsZCBiZSB1c2VkIGZvciBjYXJlIHRoYXQgcmVzdWx0IGluIGluZm9ybWF0aW9uIGFib3V0IHRoZSBwYXRpZW50IChlLmcuIGEgZGlhZ25vc3RpYyB0ZXN0ICYgcmVzdWx0KSBidXQgZG8gbm90IGFsdGVyIHBoeXNpY2FsIHN0YXRlLS0+DQoJCQkJCQk8b2JzZXJ2YXRpb24gY2xhc3NDb2RlPSJPQlMiIG1vb2RDb2RlPSJFVk4iPg0KCQkJCQkJCTx0ZW1wbGF0ZUlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjEwLjIwLjIyLjQuMTMiIGV4dGVuc2lvbj0iMjAxNC0wNi0wOSIvPg0KCQkJCQkJCTxpZCByb290PSJjMDNlNTQ0NS1hZjFiLTQ5MTEtYTQxOS1lMjc4MmYyMTQ0OGMiLz4NCgkJCQkJCQk8Y29kZSB4c2k6dHlwZT0iQ0UiIGNvZGU9IjI2ODQwMDAwMiIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi45NiIgZGlzcGxheU5hbWU9IjEyIGxlYWQgRUNHIiBjb2RlU3lzdGVtTmFtZT0iU05PTUVELUNUIj4NCgkJCQkJCQkJPG9yaWdpbmFsVGV4dD4gRWxlY3Ryb2NhcmRpb2dyYW0gKDEyLUxlYWQpPHJlZmVyZW5jZSB2YWx1ZT0iI1Byb2NlZHVyZURlc2MyIi8+DQoJCQkJCQkJCTwvb3JpZ2luYWxUZXh0Pg0KCQkJCQkJCQk8dHJhbnNsYXRpb24geHNpOnR5cGU9IkNFIiBjb2RlPSI5MzAwMCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xMiIgZGlzcGxheU5hbWU9IkVsZWN0cm9jYXJkaW9ncmFtLCBjb21wbGV0ZSIgY29kZVN5c3RlbU5hbWU9IkNQVCIvPg0KCQkJCQkJCQk8dHJhbnNsYXRpb24geHNpOnR5cGU9IkNFIiBjb2RlPSJHODcwNCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xMyIgZGlzcGxheU5hbWU9IjEyLUxlYWQgRWxlY3Ryb2NhcmRpb2dyYW0gKEVjZykgUGVyZm9ybWVkIiBjb2RlU3lzdGVtTmFtZT0iSENQQ1MiLz4NCgkJCQkJCQkJPHRyYW5zbGF0aW9uIHhzaTp0eXBlPSJDRSIgY29kZT0iODkuNTIiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMTA0IiBkaXNwbGF5TmFtZT0iRWxlY3Ryb2NhcmRpb2dyYW0iIGNvZGVTeXN0ZW1OYW1lPSJJQ0QtOSBQcm9jZWR1cmUiLz4NCgkJCQkJCQkJPHRyYW5zbGF0aW9uIHhzaTp0eXBlPSJDRSIgY29kZT0iNEEwMlg0WiIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi40IiBkaXNwbGF5TmFtZT0iTWVhc3VyZW1lbnQgb2YgQ2FyZGlhYyBFbGVjdHJpY2FsIEFjdGl2aXR5LCBFeHRlcm5hbCBBcHByb2FjaCIgY29kZVN5c3RlbU5hbWU9IklDRC0xMCBQcm9jZWR1cmUiLz4NCgkJCQkJCQk8L2NvZGU+DQoJCQkJCQkJPHRleHQ+DQoJCQkJCQkJCTxyZWZlcmVuY2UgdmFsdWU9IiNQcm9jZWR1cmUyIi8+DQoJCQkJCQkJPC90ZXh0Pg0KCQkJCQkJCTxzdGF0dXNDb2RlIGNvZGU9ImNvbXBsZXRlZCIvPg0KCQkJCQkJCTxlZmZlY3RpdmVUaW1lIHZhbHVlPSIyMDE0MTAwMTEwMzAyNi0wNTAwIi8+DQoJCQkJCQkJPCEtLSBXaGVuIGNob29zaW5nIGFuIG9ic2VydmF0aW9uLCB2YWx1ZSByZWNvcmRzIHJlbGV2YW50IGZpbmRpbmdzLS0+DQoJCQkJCQkJPHZhbHVlIHhzaTp0eXBlPSJDRCIgY29kZT0iMjUxMTM1MDAyIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42Ljk2IiBkaXNwbGF5TmFtZT0iQm9yZGVybGluZSBub3JtYWwgRUNHIiBjb2RlU3lzdGVtTmFtZT0iU05PTUVELUNUIi8+DQoJCQkJCQkJPCEtLSB0YXJnZXRTaXRlQ29kZSBpbmRpY2F0ZXMgdGhlIGJvZHkgc2l0ZSBhZGRyZXNzZWQgYnkgb2JzZXJ2YXRpb24gYW5kIG11c3QgYmUgZnJvbSB2YWx1ZSBzZXQgMi4xNi44NDAuMS4xMTM4ODMuMy44OC4xMi4zMjIxLjguOS0tPg0KCQkJCQkJCTx0YXJnZXRTaXRlQ29kZSBjb2RlPSIzMDI1MDkwMDQiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuOTYiIGRpc3BsYXlOYW1lPSJFbnRpcmUgSGVhcnQiIGNvZGVTeXN0ZW1OYW1lPSJTTk9NRUQtQ1QiLz4NCgkJCQkJCQk8cGVyZm9ybWVyPg0KCQkJCQkJCQk8YXNzaWduZWRFbnRpdHk+DQoJCQkJCQkJCQk8aWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTkuNS45OTk5LjQ1NiIgZXh0ZW5zaW9uPSIyOTgxODIzIi8+DQoJCQkJCQkJCQk8YWRkcj4NCgkJCQkJCQkJCQk8c3RyZWV0QWRkcmVzc0xpbmU+MTAwMSBWaWxsYWdlIEF2ZW51ZTwvc3RyZWV0QWRkcmVzc0xpbmU+DQoJCQkJCQkJCQkJPGNpdHk+UG9ydGxhbmQ8L2NpdHk+DQoJCQkJCQkJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQkJCQkJCQk8cG9zdGFsQ29kZT45OTEyMzwvcG9zdGFsQ29kZT4NCgkJCQkJCQkJCQk8Y291bnRyeT5VUzwvY291bnRyeT4NCgkJCQkJCQkJCTwvYWRkcj4NCgkJCQkJCQkJCTx0ZWxlY29tIHVzZT0iV1AiIHZhbHVlPSIrMSg1NTUpNTU1LTUwMDAiLz4NCgkJCQkJCQkJCTxyZXByZXNlbnRlZE9yZ2FuaXphdGlvbiBjbGFzc0NvZGU9Ik9SRyI+DQoJCQkJCQkJCQkJPGlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjE5LjUuOTk5OS4xMzkzIi8+DQoJCQkJCQkJCQkJPG5hbWU+Q29tbXVuaXR5IEhlYWx0aCBhbmQgSG9zcGl0YWxzPC9uYW1lPg0KCQkJCQkJCQkJCTx0ZWxlY29tIHVzZT0iV1AiIHZhbHVlPSIrMSg1NTUpNTU1LTUwMDAiLz4NCgkJCQkJCQkJCQk8YWRkcj4NCgkJCQkJCQkJCQkJPHN0cmVldEFkZHJlc3NMaW5lPjEwMDEgVmlsbGFnZSBBdmVudWU8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCQkJCQkJCQk8Y2l0eT5Qb3J0bGFuZDwvY2l0eT4NCgkJCQkJCQkJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQkJCQkJCQkJPHBvc3RhbENvZGU+OTkxMjM8L3Bvc3RhbENvZGU+DQoJCQkJCQkJCQkJCTxjb3VudHJ5PlVTPC9jb3VudHJ5Pg0KCQkJCQkJCQkJCTwvYWRkcj4NCgkJCQkJCQkJCTwvcmVwcmVzZW50ZWRPcmdhbml6YXRpb24+DQoJCQkJCQkJCTwvYXNzaWduZWRFbnRpdHk+DQoJCQkJCQkJPC9wZXJmb3JtZXI+DQoJCQkJCQk8L29ic2VydmF0aW9uPg0KCQkJCQk8L2VudHJ5Pg0KCQkJCQk8ZW50cnkgdHlwZUNvZGU9IkRSSVYiPg0KCQkJCQkJPCEtLSBBY3Qgc2hvdWxkIGJlIHVzZWQgZm9yIGNhcmUgb2YgdGhlIHBhdGllbnQgdGhhdCBjYW5ub3QgYmUgY2xhc3NpZmllZCBhcyBhIHByb2NlZHVyZSBvciBvYnNlcnZhdGlvbiAoZS5nLiB3b3VuZCBkcmVzc2luZyBjaGFuZ2UsIGNvdW5zZWxpbmcpIC0tPg0KCQkJCQkJPGFjdCBjbGFzc0NvZGU9IkFDVCIgbW9vZENvZGU9IkVWTiI+DQoJCQkJCQkJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuNC4xMiIgZXh0ZW5zaW9uPSIyMDE0LTA2LTA5Ii8+DQoJCQkJCQkJPGlkIHJvb3Q9IjljMGYwNzBjLTJlOWUtNGJlMS1hNWI1LWZmNmQwZjY4MTIzYyIvPg0KCQkJCQkJCTxjb2RlIHhzaTp0eXBlPSJDRSIgY29kZT0iNjEzMTAwMDEiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuOTYiIGRpc3BsYXlOYW1lPSJOdXRyaXRpb24gZWR1Y2F0aW9uIiBjb2RlU3lzdGVtTmFtZT0iU05PTUVELUNUIj4NCgkJCQkJCQkJPG9yaWdpbmFsVGV4dD4gSW5kaXZpZHVhbCBDb3Vuc2VsaW5nIEZvciBNZWRpY2FsIE51dHJpdGlvbjxyZWZlcmVuY2UgdmFsdWU9IiNQcm9jZWR1cmVEZXNjMyIvPg0KCQkJCQkJCQk8L29yaWdpbmFsVGV4dD4NCgkJCQkJCQkJPHRyYW5zbGF0aW9uIHhzaTp0eXBlPSJDRSIgY29kZT0iOTc4MDIiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMTIiIGRpc3BsYXlOYW1lPSJNZWRpY2FsIG51dHJpdGlvbiB0aGVyYXB5OyBpbml0aWFsIiBjb2RlU3lzdGVtTmFtZT0iQ1BUIi8+DQoJCQkJCQkJCTx0cmFuc2xhdGlvbiB4c2k6dHlwZT0iQ0UiIGNvZGU9IlM5NDcwIiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42LjEzIiBkaXNwbGF5TmFtZT0iTnV0cml0aW9uYWwgY291bnNlbGluZywgZGlldCIgY29kZVN5c3RlbU5hbWU9IkhDUENTIi8+DQoJCQkJCQkJCTwhLS0gRm9yIHNvbWUgYWN0aXZpdGllcywgSUNELTkgYW5kIElDRC0xMCBwcm9jZWR1cmUgY29kZXMgbWF5IG5vdCBhcHBseSAoZS5nLiBudXRyaXRpb25hbCBjb3Vuc2VsaW5nKS4gSUNELTkgYW5kIElDRC0xMCBkaWFnbm9zaXMgY29kZXMgdHJhbnNsYXRlIGFuZCBzaG93biBiZWxvdy0tPg0KCQkJCQkJCQk8dHJhbnNsYXRpb24geHNpOnR5cGU9IkNFIiBjb2RlPSJWNjUuMyIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xMDMiIGRpc3BsYXlOYW1lPSJEaWV0YXJ5IHN1cnZlaWxsYW5jZSBhbmQgY291bnNlbGluZyIgY29kZVN5c3RlbU5hbWU9IklDRC05IERpYWdub3NpcyIvPg0KCQkJCQkJCQk8dHJhbnNsYXRpb24geHNpOnR5cGU9IkNFIiBjb2RlPSJaNzEuMyIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi45MCIgZGlzcGxheU5hbWU9IkRpZXRhcnkgY291bnNlbGluZyBhbmQgc3VydmVpbGxhbmNlIiBjb2RlU3lzdGVtTmFtZT0iSUNELTEwIERpYWdub3NpcyIvPg0KCQkJCQkJCTwvY29kZT4NCgkJCQkJCQk8dGV4dD4NCgkJCQkJCQkJPHJlZmVyZW5jZSB2YWx1ZT0iI1Byb2NlZHVyZTMiLz4NCgkJCQkJCQk8L3RleHQ+DQoJCQkJCQkJPHN0YXR1c0NvZGUgY29kZT0iY29tcGxldGVkIi8+DQoJCQkJCQkJPGVmZmVjdGl2ZVRpbWUgdmFsdWU9IjIwMTQxMDAxMTQzMjIxLTA1MDAiLz4NCgkJCQkJCQk8cGVyZm9ybWVyPg0KCQkJCQkJCQk8YXNzaWduZWRFbnRpdHk+DQoJCQkJCQkJCQk8aWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTkuNS45OTk5LjQ1NiIgZXh0ZW5zaW9uPSIyOTgxODIzIi8+DQoJCQkJCQkJCQk8YWRkcj4NCgkJCQkJCQkJCQk8c3RyZWV0QWRkcmVzc0xpbmU+MTAwMSBWaWxsYWdlIEF2ZW51ZTwvc3RyZWV0QWRkcmVzc0xpbmU+DQoJCQkJCQkJCQkJPGNpdHk+UG9ydGxhbmQ8L2NpdHk+DQoJCQkJCQkJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQkJCQkJCQk8cG9zdGFsQ29kZT45OTEyMzwvcG9zdGFsQ29kZT4NCgkJCQkJCQkJCQk8Y291bnRyeT5VUzwvY291bnRyeT4NCgkJCQkJCQkJCTwvYWRkcj4NCgkJCQkJCQkJCTx0ZWxlY29tIHVzZT0iV1AiIHZhbHVlPSIrMSg1NTUpNTU1LTUwMDAiLz4NCgkJCQkJCQkJCTxyZXByZXNlbnRlZE9yZ2FuaXphdGlvbiBjbGFzc0NvZGU9Ik9SRyI+DQoJCQkJCQkJCQkJPGlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjE5LjUuOTk5OS4xMzkzIi8+DQoJCQkJCQkJCQkJPG5hbWU+Q29tbXVuaXR5IEhlYWx0aCBhbmQgSG9zcGl0YWxzPC9uYW1lPg0KCQkJCQkJCQkJCTx0ZWxlY29tIHVzZT0iV1AiIHZhbHVlPSIrMSg1NTUpNTU1LTUwMDAiLz4NCgkJCQkJCQkJCQk8YWRkcj4NCgkJCQkJCQkJCQkJPHN0cmVldEFkZHJlc3NMaW5lPjEwMDEgVmlsbGFnZSBBdmVudWU8L3N0cmVldEFkZHJlc3NMaW5lPg0KCQkJCQkJCQkJCQk8Y2l0eT5Qb3J0bGFuZDwvY2l0eT4NCgkJCQkJCQkJCQkJPHN0YXRlPk9SPC9zdGF0ZT4NCgkJCQkJCQkJCQkJPHBvc3RhbENvZGU+OTkxMjM8L3Bvc3RhbENvZGU+DQoJCQkJCQkJCQkJCTxjb3VudHJ5PlVTPC9jb3VudHJ5Pg0KCQkJCQkJCQkJCTwvYWRkcj4NCgkJCQkJCQkJCTwvcmVwcmVzZW50ZWRPcmdhbml6YXRpb24+DQoJCQkJCQkJCTwvYXNzaWduZWRFbnRpdHk+DQoJCQkJCQkJPC9wZXJmb3JtZXI+DQoJCQkJCQk8L2FjdD4NCgkJCQkJPC9lbnRyeT4NCgkJCQk8L3NlY3Rpb24+DQoJCQk8L2NvbXBvbmVudD4NCgkJCTwhLS0gKioqKioqKioqKioqKioqKioqKiogUkVTVUxUUyAqKioqKioqKioqKioqKioqKioqKioqKiogLS0+DQoJCQk8Y29tcG9uZW50Pg0KCQkJCTxzZWN0aW9uPg0KCQkJCQk8dGVtcGxhdGVJZCByb290PSIyLjE2Ljg0MC4xLjExMzg4My4xMC4yMC4yMi4yLjMuMSIgZXh0ZW5zaW9uPSIyMDE0LTA2LTA5Ii8+DQoJCQkJCTxjb2RlIGNvZGU9IjMwOTU0LTIiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMSIgY29kZVN5c3RlbU5hbWU9IkxPSU5DIiBkaXNwbGF5TmFtZT0iUkVTVUxUUyIvPg0KCQkJCQk8dGl0bGU+UkVTVUxUUzwvdGl0bGU+DQoJCQkJCTx0ZXh0Pg0KCQkJCQkJPHRhYmxlIGJvcmRlcj0iMSIgd2lkdGg9IjEwMCUiPg0KCQkJCQkJCTx0aGVhZD4NCgkJCQkJCQkJPHRyPg0KCQkJCQkJCQkJPHRoPk5hbWU8L3RoPg0KCQkJCQkJCQkJPHRoPkFjdHVhbCBSZXN1bHQ8L3RoPg0KCQkJCQkJCQkJPHRoPkRhdGU8L3RoPg0KCQkJCQkJCQk8L3RyPg0KCQkJCQkJCTwvdGhlYWQ+DQoJCQkJCQkJPHRib2R5Pg0KCQkJCQkJCQk8dHI+DQoJCQkJCQkJCQk8dGQ+Q0JDIHdpdGggT3JkZXJlZCBNYW51YWwgRGlmZmVyZW50aWFsIHBhbmVsIC0gQmxvb2Q8L3RkPg0KCQkJCQkJCQkJPHRkLz4NCgkJCQkJCQkJCTx0ZD44LzYvMjAxMjwvdGQ+DQoJCQkJCQkJCTwvdHI+DQoJCQkJCQkJCTx0cj4NCgkJCQkJCQkJCTx0ZD4NCgkJCQkJCQkJCQk8Y29udGVudCBJRD0icmVzdWx0NSI+TGV1a29jeXRlcyBbIy8/dm9sdW1lXSBpbiBCbG9vZCBieSBNYW51YWwgY291bnQgW0xPSU5DOiA4MDQtNV08L2NvbnRlbnQ+DQoJCQkJCQkJCQk8L3RkPg0KCQkJCQkJCQkJPCEtLSBSZXByZXNlbnRhdGlvbiBvZiB0aGUgcGVuZGluZyB0ZXN0IGluIHRoZSBuYXJyYXRpdmUgc2VjdGlvbiAtLT4NCgkJCQkJCQkJCTx0ZD5QZW5kaW5nPC90ZD4NCgkJCQkJCQkJCTx0ZD44LzYvMjAxMiAxMTo0NWFtPC90ZD4NCgkJCQkJCQkJPC90cj4NCgkJCQkJCQk8L3Rib2R5Pg0KCQkJCQkJPC90YWJsZT4NCgkJCQkJPC90ZXh0Pg0KCQkJCQk8ZW50cnkgdHlwZUNvZGU9IkRSSVYiPg0KCQkJCQkJPG9yZ2FuaXplciBjbGFzc0NvZGU9IkJBVFRFUlkiIG1vb2RDb2RlPSJFVk4iPg0KCQkJCQkJCTx0ZW1wbGF0ZUlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjEwLjIwLjIyLjQuMSIgZXh0ZW5zaW9uPSIyMDE0LTA2LTA5Ii8+DQoJCQkJCQkJPGlkIHJvb3Q9IjdkNWEwMmIwLTY3YTQtMTFkYi1iZDEzLTA4MDAyMDBjOWE2NiIvPg0KCQkJCQkJCTxjb2RlIHhzaTp0eXBlPSJDRSIgY29kZT0iNTc3ODItNSIgZGlzcGxheU5hbWU9IkNCQyB3aXRoIE9yZGVyZWQgTWFudWFsIERpZmZlcmVudGlhbCBwYW5lbCAtIEJsb29kIiBjb2RlU3lzdGVtTmFtZT0iTE9JTkMiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMSIvPg0KCQkJCQkJCTwhLS0gU3RhdHVzIGlzIGFjdGl2ZSBzaW5jZSBhbGwgY29tcG9uZW50cyBhcmUgbm90IGNvbXBsZXRlIC0tPg0KCQkJCQkJCTxzdGF0dXNDb2RlIGNvZGU9ImFjdGl2ZSIvPg0KCQkJCQkJCTwhLS0gVGhpcyBpcyBvbmUgY29tcG9uZW50IG9mIHNldmVyYWwgdGhhdCB3b3VsZCB0eXBpY2FsbHkgaW4gaW4gQ0JDLiBTaW5nbGUgcmVzdWx0IHRvIGlsbHVzdHJhdGUgcGVuZGluZyBpbmZvcm1hdGlvbiAtLT4NCgkJCQkJCQk8Y29tcG9uZW50Pg0KCQkJCQkJCQk8b2JzZXJ2YXRpb24gY2xhc3NDb2RlPSJPQlMiIG1vb2RDb2RlPSJFVk4iPg0KCQkJCQkJCQkJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuNC4yIiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgkJCQkJCQkJCTxpZCByb290PSI2ODc2MjM5MS1iZmE1LTRkZmEtOWY2Zi1kMzcxMDlhOTdkMTkiLz4NCgkJCQkJCQkJCTxjb2RlIHhzaTp0eXBlPSJDRSIgY29kZT0iODA0LTUiIGRpc3BsYXlOYW1lPSJMZXVrb2N5dGVzIFsjLz92b2x1bWVdIGluIEJsb29kIGJ5IE1hbnVhbCBjb3VudCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xIiBjb2RlU3lzdGVtTmFtZT0iTE9JTkMiLz4NCgkJCQkJCQkJCTx0ZXh0Pg0KCQkJCQkJCQkJCTxyZWZlcmVuY2UgdmFsdWU9IiNyZXN1bHQ1Ii8+DQoJCQkJCQkJCQk8L3RleHQ+DQoJCQkJCQkJCQk8IS0tIFN0YXR1cyBvZiB0aGlzIHRlc3QgaXMgYWN0aXZlIC0tPg0KCQkJCQkJCQkJPHN0YXR1c0NvZGUgY29kZT0iYWN0aXZlIi8+DQoJCQkJCQkJCQk8ZWZmZWN0aXZlVGltZSB2YWx1ZT0iMjAxNDEwMTUxMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJPCEtLSBUaGlzIHNob3VsZCByZXByZXNlbnQgd2hhdCB0aGUgRUhSIG9yIG90aGVyIHN5c3RlbSByZWNlaXZlZCBmcm9tIHRoZSBsYWIgLS0+DQoJCQkJCQkJCQk8IS0tIFRoZSBtb3JlIGNvbW1vbiBzY2VuYXJpbyBpcyB0aGUgcmVzdWx0IGlzIG5vdCBwcmVzZW50IChpLmUuIHlvdSB3b3VsZG4ndCBpbmNsdWRlIGFueXRoaW5nKS0tPg0KCQkJCQkJCQkJPCEtLSBUaGUgdGFzayBmb3JjZSBjcmVhdGVkIHRoaXMgZXhhbXBsZSBiZWNhc3VlIGl0IGNhbWUgdXAgZHVyaW5nIGNlcnRpZmljYXRpb24gdGVzdGluZy0tPg0KCQkJCQkJCQkJPCEtLSBXZSBkbyBub3QgYmVsaWV2ZSB0aGlzIGlzIGEgY29tbW9uIHNjZW5hcmlvIC0tPg0KCQkJCQkJCQkJPHZhbHVlIHhzaTp0eXBlPSJQUSIgbnVsbEZsYXZvcj0iTkEiLz4NCgkJCQkJCQkJCTwhLS0gaW50ZXByZXRhdGlvbkNvZGUgYW5kIHJlZmVyZW5jZVJhbmdlIGFyZSBvbWl0dGVkIHNpbmNlIHBlbmRpbmcgcmVzdWx0LiBZb3UgY291bGQgYWxzbyBzaG93IGFzIG51bGwgLS0+DQoJCQkJCQkJCTwvb2JzZXJ2YXRpb24+DQoJCQkJCQkJPC9jb21wb25lbnQ+DQoJCQkJCQk8L29yZ2FuaXplcj4NCgkJCQkJPC9lbnRyeT4NCgkJCQk8L3NlY3Rpb24+DQoJCQk8L2NvbXBvbmVudD4NCgkJCTwhLS0gKioqKioqKioqKioqKioqKioqKiBTT0NJQUwgSElTVE9SWSAqKioqKioqKioqKioqKioqKioqKiogLS0+DQoJCQk8Y29tcG9uZW50Pg0KCQkJCTxzZWN0aW9uPg0KCQkJCQk8IS0tICAqKiBTb2NpYWwgaGlzdG9yeSBzZWN0aW9uICoqIC0tPg0KCQkJCQk8dGVtcGxhdGVJZCByb290PSIyLjE2Ljg0MC4xLjExMzg4My4xMC4yMC4yMi4yLjE3IiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgkJCQkJPGNvZGUgY29kZT0iMjk3NjItMiIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xIiBkaXNwbGF5TmFtZT0iU29jaWFsIEhpc3RvcnkiLz4NCgkJCQkJPHRpdGxlPlNPQ0lBTCBISVNUT1JZPC90aXRsZT4NCgkJCQkJPHRleHQ+DQoJCQkJCQk8dGFibGUgYm9yZGVyPSIxIiB3aWR0aD0iMTAwJSI+DQoJCQkJCQkJPHRoZWFkPg0KCQkJCQkJCQk8dHI+DQoJCQkJCQkJCQk8dGg+U29jaWFsIEhpc3RvcnkgT2JzZXJ2YXRpb248L3RoPg0KCQkJCQkJCQkJPHRoPkRlc2NyaXB0aW9uPC90aD4NCgkJCQkJCQkJCTx0aD5EYXRlcyBPYnNlcnZlZDwvdGg+DQoJCQkJCQkJCTwvdHI+DQoJCQkJCQkJPC90aGVhZD4NCgkJCQkJCQk8dGJvZHk+DQoJCQkJCQkJCTx0cj4NCgkJCQkJCQkJCTx0ZD5DdXJyZW50IFNtb2tpbmcgU3RhdHVzPC90ZD4NCgkJCQkJCQkJCTx0ZD4NCgkJCQkJCQkJCQk8Y29udGVudCBJRD0ic29jMSIvPlVua25vd24gaWYgZXZlciBzbW9rZWQ8L3RkPg0KCQkJCQkJCQkJPHRkPlNlcHRlbWJlciAxMCwgMjAxMiAxMTo0NWFtPC90ZD4NCgkJCQkJCQkJPC90cj4NCgkJCQkJCQk8L3Rib2R5Pg0KCQkJCQkJPC90YWJsZT4NCgkJCQkJPC90ZXh0Pg0KCQkJCQk8ZW50cnkgdHlwZUNvZGU9IkRSSVYiPg0KCQkJCQkJPG9ic2VydmF0aW9uIGNsYXNzQ29kZT0iT0JTIiBtb29kQ29kZT0iRVZOIj4NCgkJCQkJCQk8IS0tICoqIEN1cnJlbnQgc21va2luZyBzdGF0dXMgb2JzZXJ2YXRpb24gKiogLS0+DQoJCQkJCQkJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuNC43OCIgZXh0ZW5zaW9uPSIyMDE0LTA2LTA5Ii8+DQoJCQkJCQkJPGlkIGV4dGVuc2lvbj0iMTIzNDU2Nzg5IiByb290PSIyLjE2Ljg0MC4xLjExMzg4My4xOSIvPg0KCQkJCQkJCTxjb2RlIGNvZGU9IjcyMTY2LTIiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMSIgZGlzcGxheU5hbWU9IlRvYmFjY28gc21va2luZyBzdGF0dXMgTkhJUyIvPg0KCQkJCQkJCTxzdGF0dXNDb2RlIGNvZGU9ImNvbXBsZXRlZCIvPg0KCQkJCQkJCTwhLS0gVGhpcyB0ZW1wbGF0ZSByZXByZXNlbnRzIGEgk3NuYXBzaG90IGluIHRpbWWUIG9ic2VydmF0aW9uLCBzaW1wbHkgcmVmbGVjdGluZyB3aGF0IHRoZSBwYXRpZW50knMgDQoJCQkJCQkJCWN1cnJlbnQgc21va2luZyBzdGF0dXMgaXMgYXQgdGhlIHRpbWUgb2YgdGhlIG9ic2VydmF0aW9uLiBBcyBhIHJlc3VsdCwgdGhlIGVmZmVjdGl2ZVRpbWUgaXMgDQoJCQkJCQkJCWNvbnN0cmFpbmVkIHRvIGp1c3QgYSB0aW1lIHN0YW1wLCBhbmQgd2lsbCBhcHByb3hpbWF0ZWx5IGNvcnJlc3BvbmQgd2l0aCB0aGUgYXV0aG9yL3RpbWUuIC0tPg0KCQkJCQkJCTxlZmZlY3RpdmVUaW1lIHZhbHVlPSIyMDE0MTAwMTEwMzAyNi0wNTAwIi8+DQoJCQkJCQkJPCEtLSBUaGUgdmFsdWUgcmVwcmVzZW50cyB0aGUgcGF0aWVudCdzIHNtb2tpbmcgc3RhdHVzIGN1cnJlbnRseSBvYnNlcnZlZC4gLS0+DQoJCQkJCQkJPHZhbHVlIHhzaTp0eXBlPSJDRCIgY29kZT0iMjY2OTI3MDAxIiBkaXNwbGF5TmFtZT0iVW5rbm93biBpZiBldmVyIHNtb2tlZCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi45NiIvPg0KCQkJCQkJCTxhdXRob3IgdHlwZUNvZGU9IkFVVCI+DQoJCQkJCQkJCTx0aW1lIHZhbHVlPSIyMDE0MTAwMTEwMzAyNi0wNTAwIi8+DQoJCQkJCQkJCTxhc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCTxpZCBleHRlbnNpb249IjU1NTU1NTU1NTUiIHJvb3Q9IjEuMS4xLjEuMS4xLjEuMiIvPg0KCQkJCQkJCQk8L2Fzc2lnbmVkQXV0aG9yPg0KCQkJCQkJCTwvYXV0aG9yPg0KCQkJCQkJPC9vYnNlcnZhdGlvbj4NCgkJCQkJPC9lbnRyeT4NCgkJCQk8L3NlY3Rpb24+DQoJCQk8L2NvbXBvbmVudD4NCgkJCTwhLS0gKioqKioqKioqKioqKiBWSVRBTCBTSUdOUyAqKioqKioqKioqKioqKiogLS0+DQoJCQk8Y29tcG9uZW50Pg0KCQkJCTxzZWN0aW9uPg0KCQkJCQk8IS0tICoqIFZpdGFsIFNpZ25zIHNlY3Rpb24gd2l0aCBlbnRyaWVzIHJlcXVpcmVkICoqIC0tPg0KCQkJCQk8IS0tIE9ubHkgc2VsZWN0IHZpdGFsIHNpZ25zIGFyZSBzaG93biBiZWxvdyBidXQgYSBtb3JlIGNvbXBsZXRlIGxpc3Qgb2YgY29tbW9uIHZpdGFsIHNpZ25zIG1heSBpbmNsdWRlOiAtLT4NCgkJCQkJPCEtLSBIZWlnaHQsIFdlaWdodCwgQm9keSBNYXNzIEluZGV4LCBTeXN0b2xpYyBCbG9vZCBQcmVzc3VyZSwgRGlhc3Rsb2ljIEJsb29kIFByZXNzdXJlLCBIZWFydCBSYXRlIChQdWxzZSkNCgkJCQkJIFJlc3BpcmF0b3J5IFJhdGUsIFB1bHNlIE94aW1ldHJ5IChzcE8yKSwgVGVtcGVyYXR1cmUsIEJvZHkgU3VyZmFjZSBBcmVhLCBIZWFkIENpcmN1bWZlcmVuY2UtLT4NCgkJCQkJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuMi40LjEiIGV4dGVuc2lvbj0iMjAxNC0wNi0wOSIvPg0KCQkJCQk8Y29kZSBjb2RlPSI4NzE2LTMiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMSIgY29kZVN5c3RlbU5hbWU9IkxPSU5DIiBkaXNwbGF5TmFtZT0iVml0YWwgU2lnbnMiLz4NCgkJCQkJPHRpdGxlPlZpdGFsIFNpZ25zIChMYXN0IEZpbGVkKTwvdGl0bGU+DQoJCQkJCTx0ZXh0Pg0KCQkJCQkJPHRhYmxlPg0KCQkJCQkJCTx0aGVhZD4NCgkJCQkJCQkJPHRyPg0KCQkJCQkJCQkJPHRoPkRhdGU8L3RoPg0KCQkJCQkJCQkJPHRoPkJsb29kIFByZXNzdXJlPC90aD4NCgkJCQkJCQkJCTx0aD5QdWxzZTwvdGg+DQoJCQkJCQkJCQk8dGg+VGVtcGVyYXR1cmU8L3RoPg0KCQkJCQkJCQkJPHRoPlJlc3BpcmF0b3J5IFJhdGU8L3RoPg0KCQkJCQkJCQkJPHRoPkhlaWdodDwvdGg+DQoJCQkJCQkJCQk8dGg+V2VpZ2h0PC90aD4NCgkJCQkJCQkJCTx0aD5CTUk8L3RoPg0KCQkJCQkJCQkJPHRoPlNwTzI8L3RoPg0KCQkJCQkJCQk8L3RyPg0KCQkJCQkJCTwvdGhlYWQ+DQoJCQkJCQkJPHRib2R5Pg0KCQkJCQkJCQk8dHI+DQoJCQkJCQkJCQk8dGQ+MDUvMjAvMjAxNCA3OjM2cG08L3RkPg0KCQkJCQkJCQkJPCEtLSBZb3UgY2FuIGNvbnNvbGlkYXRlIFN5c3RvbGljIGFuZCBEaWFzdG9saWMgaW4gaHVtYW4gdmlldyBpZiBkZXNpcmVkIGJ1dCBzaG91bGQgcmV0YWluIHNlcGFyYXRlIHJlZmVyZW5jZXMtLT4NCgkJCQkJCQkJCTx0ZD4NCgkJCQkJCQkJCQk8Y29udGVudCBJRD0iU3lzdG9saWNCUF8xIj4xMjA8L2NvbnRlbnQ+Lzxjb250ZW50IElEPSJEaWFzdG9saWNCUF8xIj44MDwvY29udGVudD5tbVtIZ10gPC90ZD4NCgkJCQkJCQkJCTx0ZCBJRD0iUHVsc2VfMSI+ODAgL21pbjwvdGQ+DQoJCQkJCQkJCQk8dGQgSUQ9IlRlbXBfMSI+MzcuMiBDPC90ZD4NCgkJCQkJCQkJCTx0ZCBJRD0iUmVzcFJhdGVfMSI+MTggL21pbjwvdGQ+DQoJCQkJCQkJCQk8dGQgSUQ9IkhlaWdodF8xIj4xNzAuMiBjbTwvdGQ+DQoJCQkJCQkJCQk8dGQgSUQ9IldlaWdodF8xIj4xMDguOCBrZzwvdGQ+DQoJCQkJCQkJCQk8dGQgSUQ9IkJNSV8xIj4zNy41OCBrZy9tMjwvdGQ+DQoJCQkJCQkJCQk8dGQgSUQ9IlNQTzJfMSI+OTglPC90ZD4NCgkJCQkJCQkJPC90cj4NCgkJCQkJCQk8L3Rib2R5Pg0KCQkJCQkJPC90YWJsZT4NCgkJCQkJPC90ZXh0Pg0KCQkJCQk8ZW50cnkgdHlwZUNvZGU9IkRSSVYiPg0KCQkJCQkJPCEtLSBXaGVuIGEgc2V0IG9mIHZpdGFsIHNpZ25zIGFyZSByZWNvcmRlZCB0b2dldGhlciwgaW5jbHVkZSB0aGVtIGluIHNpbmdsZSBjbHVzdGVyZWQgb3JnYW5pemVyLS0+DQoJCQkJCQk8b3JnYW5pemVyIGNsYXNzQ29kZT0iQ0xVU1RFUiIgbW9vZENvZGU9IkVWTiI+DQoJCQkJCQkJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuNC4yNiIgZXh0ZW5zaW9uPSIyMDE0LTA2LTA5Ii8+DQoJCQkJCQkJPGlkIHJvb3Q9ImU2YzgwMGM0LTRhNzEtNDFiZi04MGUyLWU3NDFkZDExNjhlOSIvPg0KCQkJCQkJCTxjb2RlIGNvZGU9Ijc0NzI4LTciIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMSIgY29kZVN5c3RlbU5hbWU9IkxPSU5DIiBkaXNwbGF5TmFtZT0iVklUQUwgU0lHTlMiLz4NCgkJCQkJCQk8c3RhdHVzQ29kZSBjb2RlPSJjb21wbGV0ZWQiLz4NCgkJCQkJCQk8ZWZmZWN0aXZlVGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCTwhLS0gRWFjaCB2aXRhbCBzaWduIHNob3VsZCBiZSBpdHMgb3duIGNvbXBvbmVudC4gTm90ZSB0aGF0IHN5c3RvbGljIGFuZCBkaWFzdG9saWMgQlAgbXVzdCBiZSBzZXBhcmF0ZSBjb21wb25lbnRzLS0+DQoJCQkJCQkJPGNvbXBvbmVudD4NCgkJCQkJCQkJPG9ic2VydmF0aW9uIGNsYXNzQ29kZT0iT0JTIiBtb29kQ29kZT0iRVZOIj4NCgkJCQkJCQkJCTx0ZW1wbGF0ZUlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjEwLjIwLjIyLjQuMjciIGV4dGVuc2lvbj0iMjAxNC0wNi0wOSIvPg0KCQkJCQkJCQkJPGlkIHJvb3Q9ImZkYmQ4MzFiLTU5MTktNGYwNi05NDY3LTc2YjA3MDIyZjhlOCIvPg0KCQkJCQkJCQkJPGNvZGUgY29kZT0iODQ4MC02IiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42LjEiIGNvZGVTeXN0ZW1OYW1lPSJMT0lOQyIgZGlzcGxheU5hbWU9IlNZU1RPTElDIEJMT09EIFBSRVNTVVJFIi8+DQoJCQkJCQkJCQk8dGV4dD4NCgkJCQkJCQkJCQk8IS0tIFRoaXMgcmVmZXJlbmNlIGlkZW50aWZpZXMgY29udGVudCBpbiBodW1hbiByZWFkYWJsZSBmb3JtYXR0ZWQgdGV4dC0tPg0KCQkJCQkJCQkJCTxyZWZlcmVuY2UgdmFsdWU9IiNTeXN0b2xpY0JQXzEiLz4NCgkJCQkJCQkJCTwvdGV4dD4NCgkJCQkJCQkJCTxzdGF0dXNDb2RlIGNvZGU9ImNvbXBsZXRlZCIvPg0KCQkJCQkJCQkJPGVmZmVjdGl2ZVRpbWUgdmFsdWU9IjIwMTQxMDAxMTAzMDI2LTA1MDAiLz4NCgkJCQkJCQkJCTwhLS0gRXhhbXBsZSBvZiBWYWx1ZSB3aXRoIFVDVU0gdW5pdC4gTm90ZSB0aGF0IG1ldHJpYyB1bml0cyB1c2VkIGluIHRoaXMgZXhhbXBsZS0tPg0KCQkJCQkJCQkJPHZhbHVlIHhzaTp0eXBlPSJQUSIgdmFsdWU9IjEyMCIgdW5pdD0ibW1bSGddIi8+DQoJCQkJCQkJCQk8IS0tIEFkZGl0aW9uYWwgaW5mb3JtYXRpb24gb2YgaW50ZXJwcmV0YXRpb24gYW5kL29yIHJlZmVyZW5jZSByYW5nZSBtYXkgYmUgaW5jbHVkZWQgYnV0IGFyZSBvcHRpb25hbC0tPg0KCQkJCQkJCQkJPGF1dGhvciB0eXBlQ29kZT0iQVVUIj4NCgkJCQkJCQkJCQk8dGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJCTxhc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCQkJPGlkIGV4dGVuc2lvbj0iNTU1NTU1NTU1NSIgcm9vdD0iMS4xLjEuMS4xLjEuMS4yIi8+DQoJCQkJCQkJCQkJPC9hc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCTwvYXV0aG9yPg0KCQkJCQkJCQk8L29ic2VydmF0aW9uPg0KCQkJCQkJCTwvY29tcG9uZW50Pg0KCQkJCQkJCTxjb21wb25lbnQ+DQoJCQkJCQkJCTxvYnNlcnZhdGlvbiBjbGFzc0NvZGU9Ik9CUyIgbW9vZENvZGU9IkVWTiI+DQoJCQkJCQkJCQk8dGVtcGxhdGVJZCByb290PSIyLjE2Ljg0MC4xLjExMzg4My4xMC4yMC4yMi40LjI3IiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgkJCQkJCQkJCTxpZCByb290PSI1NTNmM2Y0NS05MDQ2LTQ2NTktYjNlNy01ZGU5MDQwMDM1NTAiLz4NCgkJCQkJCQkJCTxjb2RlIGNvZGU9Ijg0NjItNCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xIiBjb2RlU3lzdGVtTmFtZT0iTE9JTkMiIGRpc3BsYXlOYW1lPSJESUFTVE9MSUMgQkxPT0QgUFJFU1NVUkUiLz4NCgkJCQkJCQkJCTx0ZXh0Pg0KCQkJCQkJCQkJCTxyZWZlcmVuY2UgdmFsdWU9IiNEaWFzdG9saWNCUF8xIi8+DQoJCQkJCQkJCQk8L3RleHQ+DQoJCQkJCQkJCQk8c3RhdHVzQ29kZSBjb2RlPSJjb21wbGV0ZWQiLz4NCgkJCQkJCQkJCTxlZmZlY3RpdmVUaW1lIHZhbHVlPSIyMDE0MTAwMTEwMzAyNi0wNTAwIi8+DQoJCQkJCQkJCQk8dmFsdWUgeHNpOnR5cGU9IlBRIiB2YWx1ZT0iODAiIHVuaXQ9Im1tW0hnXSIvPg0KCQkJCQkJCQkJPGF1dGhvciB0eXBlQ29kZT0iQVVUIj4NCgkJCQkJCQkJCQk8dGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJCTxhc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCQkJPGlkIGV4dGVuc2lvbj0iNTU1NTU1NTU1NSIgcm9vdD0iMS4xLjEuMS4xLjEuMS4yIi8+DQoJCQkJCQkJCQkJPC9hc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCTwvYXV0aG9yPg0KCQkJCQkJCQk8L29ic2VydmF0aW9uPg0KCQkJCQkJCTwvY29tcG9uZW50Pg0KCQkJCQkJCTxjb21wb25lbnQ+DQoJCQkJCQkJCTxvYnNlcnZhdGlvbiBjbGFzc0NvZGU9Ik9CUyIgbW9vZENvZGU9IkVWTiI+DQoJCQkJCQkJCQk8dGVtcGxhdGVJZCByb290PSIyLjE2Ljg0MC4xLjExMzg4My4xMC4yMC4yMi40LjI3IiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgkJCQkJCQkJCTxpZCByb290PSI3N2JmZTI3Ni1hMWRkLTQzNzItOTA3Mi1lNjAzOTA1YWNjMDciLz4NCgkJCQkJCQkJCTxjb2RlIGNvZGU9Ijg4NjctNCIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xIiBjb2RlU3lzdGVtTmFtZT0iTE9JTkMiIGRpc3BsYXlOYW1lPSJIRUFSVCBSQVRFIi8+DQoJCQkJCQkJCQk8dGV4dD4NCgkJCQkJCQkJCQk8cmVmZXJlbmNlIHZhbHVlPSIjUHVsc2VfMSIvPg0KCQkJCQkJCQkJPC90ZXh0Pg0KCQkJCQkJCQkJPHN0YXR1c0NvZGUgY29kZT0iY29tcGxldGVkIi8+DQoJCQkJCQkJCQk8ZWZmZWN0aXZlVGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJPHZhbHVlIHhzaTp0eXBlPSJQUSIgdmFsdWU9IjgwIiB1bml0PSIvbWluIi8+DQoJCQkJCQkJCQk8YXV0aG9yIHR5cGVDb2RlPSJBVVQiPg0KCQkJCQkJCQkJCTx0aW1lIHZhbHVlPSIyMDE0MTAwMTEwMzAyNi0wNTAwIi8+DQoJCQkJCQkJCQkJPGFzc2lnbmVkQXV0aG9yPg0KCQkJCQkJCQkJCQk8aWQgZXh0ZW5zaW9uPSI1NTU1NTU1NTU1IiByb290PSIxLjEuMS4xLjEuMS4xLjIiLz4NCgkJCQkJCQkJCQk8L2Fzc2lnbmVkQXV0aG9yPg0KCQkJCQkJCQkJPC9hdXRob3I+DQoJCQkJCQkJCTwvb2JzZXJ2YXRpb24+DQoJCQkJCQkJPC9jb21wb25lbnQ+DQoJCQkJCQkJPGNvbXBvbmVudD4NCgkJCQkJCQkJPG9ic2VydmF0aW9uIGNsYXNzQ29kZT0iT0JTIiBtb29kQ29kZT0iRVZOIj4NCgkJCQkJCQkJCTx0ZW1wbGF0ZUlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjEwLjIwLjIyLjQuMjciIGV4dGVuc2lvbj0iMjAxNC0wNi0wOSIvPg0KCQkJCQkJCQkJPGlkIHJvb3Q9IjI0ZmFhMjA0LWRiNjItNDYxMC04NjRmLWNiNTBiNjUwZDBmYSIvPg0KCQkJCQkJCQkJPGNvZGUgY29kZT0iODMxMC01IiBjb2RlU3lzdGVtPSIyLjE2Ljg0MC4xLjExMzg4My42LjEiIGNvZGVTeXN0ZW1OYW1lPSJMT0lOQyIgZGlzcGxheU5hbWU9IkJPRFkgVEVNUEVSQVRVUkUiLz4NCgkJCQkJCQkJCTx0ZXh0Pg0KCQkJCQkJCQkJCTxyZWZlcmVuY2UgdmFsdWU9IiNUZW1wXzEiLz4NCgkJCQkJCQkJCTwvdGV4dD4NCgkJCQkJCQkJCTxzdGF0dXNDb2RlIGNvZGU9ImNvbXBsZXRlZCIvPg0KCQkJCQkJCQkJPGVmZmVjdGl2ZVRpbWUgdmFsdWU9IjIwMTQxMDAxMTAzMDI2LTA1MDAiLz4NCgkJCQkJCQkJCTx2YWx1ZSB4c2k6dHlwZT0iUFEiIHZhbHVlPSIzNy4yIiB1bml0PSJDZWwiLz4NCgkJCQkJCQkJCTxhdXRob3IgdHlwZUNvZGU9IkFVVCI+DQoJCQkJCQkJCQkJPHRpbWUgdmFsdWU9IjIwMTQxMDAxMTAzMDI2LTA1MDAiLz4NCgkJCQkJCQkJCQk8YXNzaWduZWRBdXRob3I+DQoJCQkJCQkJCQkJCTxpZCBleHRlbnNpb249IjU1NTU1NTU1NTUiIHJvb3Q9IjEuMS4xLjEuMS4xLjEuMiIvPg0KCQkJCQkJCQkJCTwvYXNzaWduZWRBdXRob3I+DQoJCQkJCQkJCQk8L2F1dGhvcj4NCgkJCQkJCQkJPC9vYnNlcnZhdGlvbj4NCgkJCQkJCQk8L2NvbXBvbmVudD4NCgkJCQkJCQk8Y29tcG9uZW50Pg0KCQkJCQkJCQk8b2JzZXJ2YXRpb24gY2xhc3NDb2RlPSJPQlMiIG1vb2RDb2RlPSJFVk4iPg0KCQkJCQkJCQkJPHRlbXBsYXRlSWQgcm9vdD0iMi4xNi44NDAuMS4xMTM4ODMuMTAuMjAuMjIuNC4yNyIgZXh0ZW5zaW9uPSIyMDE0LTA2LTA5Ii8+DQoJCQkJCQkJCQk8aWQgcm9vdD0iNzlmMjUzOTUtOGVjNi00ODhiLThjMDUtYmVjYzk3Zjc5OTk1Ii8+DQoJCQkJCQkJCQk8Y29kZSBjb2RlPSI5Mjc5LTEiIGNvZGVTeXN0ZW09IjIuMTYuODQwLjEuMTEzODgzLjYuMSIgY29kZVN5c3RlbU5hbWU9IkxPSU5DIiBkaXNwbGF5TmFtZT0iUkVTUElSQVRPUlkgUkFURSIvPg0KCQkJCQkJCQkJPHRleHQ+DQoJCQkJCQkJCQkJPHJlZmVyZW5jZSB2YWx1ZT0iI1Jlc3BSYXRlXzEiLz4NCgkJCQkJCQkJCTwvdGV4dD4NCgkJCQkJCQkJCTxzdGF0dXNDb2RlIGNvZGU9ImNvbXBsZXRlZCIvPg0KCQkJCQkJCQkJPGVmZmVjdGl2ZVRpbWUgdmFsdWU9IjIwMTQxMDAxMTAzMDI2LTA1MDAiLz4NCgkJCQkJCQkJCTx2YWx1ZSB4c2k6dHlwZT0iUFEiIHZhbHVlPSIxOCIgdW5pdD0iL21pbiIvPg0KCQkJCQkJCQkJPGF1dGhvciB0eXBlQ29kZT0iQVVUIj4NCgkJCQkJCQkJCQk8dGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJCTxhc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCQkJPGlkIGV4dGVuc2lvbj0iNTU1NTU1NTU1NSIgcm9vdD0iMS4xLjEuMS4xLjEuMS4yIi8+DQoJCQkJCQkJCQkJPC9hc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCTwvYXV0aG9yPg0KCQkJCQkJCQk8L29ic2VydmF0aW9uPg0KCQkJCQkJCTwvY29tcG9uZW50Pg0KCQkJCQkJCTxjb21wb25lbnQ+DQoJCQkJCQkJCTxvYnNlcnZhdGlvbiBjbGFzc0NvZGU9Ik9CUyIgbW9vZENvZGU9IkVWTiI+DQoJCQkJCQkJCQk8dGVtcGxhdGVJZCByb290PSIyLjE2Ljg0MC4xLjExMzg4My4xMC4yMC4yMi40LjI3IiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgkJCQkJCQkJCTxpZCByb290PSI2ZDNmYTlmOC02MDQ5LTQxYmQtYjBjMy1iMDE5NmJiNmJkMzciLz4NCgkJCQkJCQkJCTxjb2RlIGNvZGU9IjgzMDItMiIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xIiBjb2RlU3lzdGVtTmFtZT0iTE9JTkMiIGRpc3BsYXlOYW1lPSJIRUlHSFQiLz4NCgkJCQkJCQkJCTx0ZXh0Pg0KCQkJCQkJCQkJCTxyZWZlcmVuY2UgdmFsdWU9IiNIZWlnaHRfMSIvPg0KCQkJCQkJCQkJPC90ZXh0Pg0KCQkJCQkJCQkJPHN0YXR1c0NvZGUgY29kZT0iY29tcGxldGVkIi8+DQoJCQkJCQkJCQk8ZWZmZWN0aXZlVGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJPHZhbHVlIHhzaTp0eXBlPSJQUSIgdmFsdWU9IjE3MC4yIiB1bml0PSJjbSIvPg0KCQkJCQkJCQkJPGF1dGhvciB0eXBlQ29kZT0iQVVUIj4NCgkJCQkJCQkJCQk8dGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJCTxhc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCQkJPGlkIGV4dGVuc2lvbj0iNTU1NTU1NTU1NSIgcm9vdD0iMS4xLjEuMS4xLjEuMS4yIi8+DQoJCQkJCQkJCQkJPC9hc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCTwvYXV0aG9yPg0KCQkJCQkJCQk8L29ic2VydmF0aW9uPg0KCQkJCQkJCTwvY29tcG9uZW50Pg0KCQkJCQkJCTxjb21wb25lbnQ+DQoJCQkJCQkJCTxvYnNlcnZhdGlvbiBjbGFzc0NvZGU9Ik9CUyIgbW9vZENvZGU9IkVWTiI+DQoJCQkJCQkJCQk8dGVtcGxhdGVJZCByb290PSIyLjE2Ljg0MC4xLjExMzg4My4xMC4yMC4yMi40LjI3IiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgkJCQkJCQkJCTxpZCByb290PSIyNTk0ZTYzMS0yMTg5LTRlNzItOWRkMS1kNjc2OWVlMmE3YmUiLz4NCgkJCQkJCQkJCTxjb2RlIGNvZGU9IjMxNDEtOSIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xIiBjb2RlU3lzdGVtTmFtZT0iTE9JTkMiIGRpc3BsYXlOYW1lPSJXRUlHSFQiLz4NCgkJCQkJCQkJCTx0ZXh0Pg0KCQkJCQkJCQkJCTxyZWZlcmVuY2UgdmFsdWU9IiNXZWlnaHRfMSIvPg0KCQkJCQkJCQkJPC90ZXh0Pg0KCQkJCQkJCQkJPHN0YXR1c0NvZGUgY29kZT0iY29tcGxldGVkIi8+DQoJCQkJCQkJCQk8ZWZmZWN0aXZlVGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJPHZhbHVlIHhzaTp0eXBlPSJQUSIgdmFsdWU9IjEwOC44NjMiIHVuaXQ9ImtnIi8+DQoJCQkJCQkJCQk8YXV0aG9yIHR5cGVDb2RlPSJBVVQiPg0KCQkJCQkJCQkJCTx0aW1lIHZhbHVlPSIyMDE0MTAwMTEwMzAyNi0wNTAwIi8+DQoJCQkJCQkJCQkJPGFzc2lnbmVkQXV0aG9yPg0KCQkJCQkJCQkJCQk8aWQgZXh0ZW5zaW9uPSI1NTU1NTU1NTU1IiByb290PSIxLjEuMS4xLjEuMS4xLjIiLz4NCgkJCQkJCQkJCQk8L2Fzc2lnbmVkQXV0aG9yPg0KCQkJCQkJCQkJPC9hdXRob3I+DQoJCQkJCQkJCTwvb2JzZXJ2YXRpb24+DQoJCQkJCQkJPC9jb21wb25lbnQ+DQoJCQkJCQkJPGNvbXBvbmVudD4NCgkJCQkJCQkJPG9ic2VydmF0aW9uIGNsYXNzQ29kZT0iT0JTIiBtb29kQ29kZT0iRVZOIj4NCgkJCQkJCQkJCTx0ZW1wbGF0ZUlkIHJvb3Q9IjIuMTYuODQwLjEuMTEzODgzLjEwLjIwLjIyLjQuMjciIGV4dGVuc2lvbj0iMjAxNC0wNi0wOSIvPg0KCQkJCQkJCQkJPGlkIHJvb3Q9IjU4NThlNzY1LTJmZmUtNDEzZi05MTk3LTI2MGYyYzZlN2FhOCIvPg0KCQkJCQkJCQkJPGNvZGUgY29kZT0iMzkxNTYtNSIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xIiBjb2RlU3lzdGVtTmFtZT0iTE9JTkMiIGRpc3BsYXlOYW1lPSJCT0RZIE1BU1MgSU5ERVgiLz4NCgkJCQkJCQkJCTx0ZXh0Pg0KCQkJCQkJCQkJCTxyZWZlcmVuY2UgdmFsdWU9IiNCTUlfMSIvPg0KCQkJCQkJCQkJPC90ZXh0Pg0KCQkJCQkJCQkJPHN0YXR1c0NvZGUgY29kZT0iY29tcGxldGVkIi8+DQoJCQkJCQkJCQk8ZWZmZWN0aXZlVGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJPHZhbHVlIHhzaTp0eXBlPSJQUSIgdmFsdWU9IjM3LjU4IiB1bml0PSJrZy9tMiIvPg0KCQkJCQkJCQkJPGF1dGhvciB0eXBlQ29kZT0iQVVUIj4NCgkJCQkJCQkJCQk8dGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJCTxhc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCQkJPGlkIGV4dGVuc2lvbj0iNTU1NTU1NTU1NSIgcm9vdD0iMS4xLjEuMS4xLjEuMS4yIi8+DQoJCQkJCQkJCQkJPC9hc3NpZ25lZEF1dGhvcj4NCgkJCQkJCQkJCTwvYXV0aG9yPg0KCQkJCQkJCQk8L29ic2VydmF0aW9uPg0KCQkJCQkJCTwvY29tcG9uZW50Pg0KCQkJCQkJCTxjb21wb25lbnQ+DQoJCQkJCQkJCTxvYnNlcnZhdGlvbiBjbGFzc0NvZGU9Ik9CUyIgbW9vZENvZGU9IkVWTiI+DQoJCQkJCQkJCQk8dGVtcGxhdGVJZCByb290PSIyLjE2Ljg0MC4xLjExMzg4My4xMC4yMC4yMi40LjI3IiBleHRlbnNpb249IjIwMTQtMDYtMDkiLz4NCgkJCQkJCQkJCTxpZCByb290PSI0Y2U2MDQ2Yy1mNmUzLTQxYjAtOTFmYy0yZDUzMjVmMmJiYzMiLz4NCgkJCQkJCQkJCTxjb2RlIGNvZGU9IjI3MTAtMiIgY29kZVN5c3RlbT0iMi4xNi44NDAuMS4xMTM4ODMuNi4xIiBjb2RlU3lzdGVtTmFtZT0iTE9JTkMiIGRpc3BsYXlOYW1lPSJPWFlHRU4gU0FUVVJBVElPTiIvPg0KCQkJCQkJCQkJPHRleHQ+DQoJCQkJCQkJCQkJPHJlZmVyZW5jZSB2YWx1ZT0iI1NQTzJfMSIvPg0KCQkJCQkJCQkJPC90ZXh0Pg0KCQkJCQkJCQkJPHN0YXR1c0NvZGUgY29kZT0iY29tcGxldGVkIi8+DQoJCQkJCQkJCQk8ZWZmZWN0aXZlVGltZSB2YWx1ZT0iMjAxNDEwMDExMDMwMjYtMDUwMCIvPg0KCQkJCQkJCQkJPHZhbHVlIHhzaTp0eXBlPSJQUSIgdmFsdWU9Ijk4IiB1bml0PSIlIi8+DQoJCQkJCQkJCQk8YXV0aG9yIHR5cGVDb2RlPSJBVVQiPg0KCQkJCQkJCQkJCTx0aW1lIHZhbHVlPSIyMDE0MTAwMTEwMzAyNi0wNTAwIi8+DQoJCQkJCQkJCQkJPGFzc2lnbmVkQXV0aG9yPg0KCQkJCQkJCQkJCQk8aWQgZXh0ZW5zaW9uPSI1NTU1NTU1NTU1IiByb290PSIxLjEuMS4xLjEuMS4xLjIiLz4NCgkJCQkJCQkJCQk8L2Fzc2lnbmVkQXV0aG9yPg0KCQkJCQkJCQkJPC9hdXRob3I+DQoJCQkJCQkJCTwvb2JzZXJ2YXRpb24+DQoJCQkJCQkJPC9jb21wb25lbnQ+DQoJCQkJCQk8L29yZ2FuaXplcj4NCgkJCQkJPC9lbnRyeT4NCgkJCQk8L3NlY3Rpb24+DQoJCQk8L2NvbXBvbmVudD4NCgkJPC9zdHJ1Y3R1cmVkQm9keT4NCgk8L2NvbXBvbmVudD4NCjwvQ2xpbmljYWxEb2N1bWVudD4="
}`;
  await fhirApi.put(`/Binary/${binaryId}`, JSON.parse(binaryData));

  const docRefId = `${orgId}.696969`;
  const data = `{
    "resourceType": "DocumentReference",
    "id": "${docRefId}",
    "meta": {
        "versionId": "19",
        "lastUpdated": "2023-02-24T16:07:16.796+00:00",
        "source": "${rootOid}"
    },
    "contained": [
        {
            "resourceType": "Organization",
            "id": "${orgId}",
            "name": "${orgName}"
        },
        {
            "resourceType": "Patient",
            "id": "${patientId}"
        }
    ],
    "masterIdentifier": {
        "system": "urn:ietf:rfc:3986",
        "value": "${docRefId}"
    },
    "identifier": [
        {
            "use": "official",
            "system": "urn:ietf:rfc:3986",
            "value": "${docRefId}"
        }
    ],
    "status": "current",
    "type": {
        "coding": [
            {
                "system": "http://loinc.org/",
                "code": "75622-1",
                "display": "HIV 1 and 2 tests - Meaningful Use set"
            }
        ]
    },
    "subject": {
        "reference": "Patient/${patientId}",
        "type": "Patient"
    },
    "author": [
        {
            "reference": "#${orgId}",
            "type": "Organization"
        }
    ],
    "description": "Summarization Of Episode Notes - provided by Metriport",
    "content": [
        {
            "attachment": {
                "contentType": "application/xml",
                "url": "${docUrl}/Binary/${binaryId}"
            }
        }
    ],
    "context": {
        "event": [
            {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": "62479008",
                        "display": "AIDS"
                    }
                ],
                "text": "AIDS"
            }
        ],
        "period": {
            "start": "2022-10-05T22:00:00.000Z",
            "end": "2022-10-05T23:00:00.000Z"
        },
        "sourcePatientInfo": {
            "reference": "#${patientId}",
            "type": "Patient"
        }
    }
}`;
  await fhirApi.put(`/DocumentReference/${docRefId}`, JSON.parse(data));
  return { docRefId, binaryId };
}
