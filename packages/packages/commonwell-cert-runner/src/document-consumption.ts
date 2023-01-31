#!/usr/bin/env node
import {
  CommonWell,
  getId,
  getIdTrailingSlash,
  isLOLA1,
  RequestMetadata,
} from "@metriport/commonwell-sdk";
import {
  getPatientStrongIds,
  getPersonIdFromSearchByPatientDemo,
} from "@metriport/commonwell-sdk/lib/common/util";
import { docPatient, docPerson, metriportSystem } from "./payloads";

// Document Consumption
// https://commonwellalliance.sharepoint.com/sites/ServiceAdopter/SitePages/Document-Consumption-(SOAP,-REST).aspx

// TODO Remove logs with the prefix '...'

export async function documentConsumption(commonWell: CommonWell, queryMeta: RequestMetadata) {
  // E1: Document Query
  console.log(`>>> E1c: Query for documents using FHIR (REST)`);

  console.log(`... Search for Patient...`, {
    firstName: docPerson.details.name[0].given[0],
    lastName: docPerson.details.name[0].family[0],
    DOB: docPerson.details.birthDate,
    gender: docPerson.details.gender.code,
    zipCode: docPerson.details.address[0].zip,
  });
  const respPatient = await commonWell.searchPatient(
    queryMeta,
    docPerson.details.name[0].given[0],
    docPerson.details.name[0].family[0],
    docPerson.details.birthDate,
    docPerson.details.gender.code,
    docPerson.details.address[0].zip
  );
  console.log(respPatient);

  let personId: string | undefined = undefined;
  let patientId: string | undefined = undefined;

  // IF THERE'S A PATIENT, USE IT IT
  if (respPatient._embedded?.patient?.length > 0) {
    const embeddedPatients = respPatient._embedded.patient;
    if (embeddedPatients.length > 1) {
      console.log(`Found more than one patient, using the first one`);
    } else {
      console.log(`Found a patient, using it`);
    }
    const patient = embeddedPatients[0];
    patientId = getIdTrailingSlash(patient);
    console.log(`... patientId: ${patientId}`);

    console.log(`... Search for Person using patient's demographics...`, { patientId: patientId });
    const respPerson = await commonWell.searchPersonByPatientDemo(queryMeta, patientId);
    console.log(respPerson);
    personId = getPersonIdFromSearchByPatientDemo(respPerson);
    console.log(`... personId: ${personId}`);

    //
  } else {
    // OTHERWISE ADD ONE
    console.log(`... Did not find a patient, creating person/patient...`);

    console.log(`... Enroll a Person with a Strong ID...`);
    const respPerson = await commonWell.enrollPerson(queryMeta, docPerson);
    console.log(respPerson);
    personId = getId(respPerson);
    console.log(`... personId: ${personId}`);

    console.log(`... Register a new Patient...`);
    const respPatientCreate = await commonWell.registerPatient(queryMeta, docPatient);
    console.log(respPatientCreate);
    patientId = getIdTrailingSlash(respPatientCreate);
    const patientStrongIds = getPatientStrongIds(respPatientCreate);
    const patientStrongId = patientStrongIds
      ? patientStrongIds.find(id => id.system === metriportSystem)
      : undefined;
    console.log(`... patientId: ${patientId}`);

    console.log(`... Link a Patient to a Person upgrading from LOLA 1 to LOLA 2...`);
    const patientLink = respPatientCreate._links.self.href;
    const respLink = await commonWell.patientLink(
      queryMeta,
      personId,
      patientLink,
      patientStrongId
    );
    console.log(respLink);
  }

  if (!personId) throw new Error(`[E1c] personId is undefined before calling getPatientsLinks()`);
  console.log(`... Get Network links...`);
  const respLinks = await commonWell.getPatientsLinks(queryMeta, patientId);
  console.log(respLinks);
  const allLinks = respLinks._embedded.networkLink;
  const lola1Links = allLinks.filter(isLOLA1);
  console.log(`Found ${allLinks.length} network links, ${lola1Links.length} are LOLA 1`);
  for (const link of lola1Links) {
    console.log(`... Upgrade link from LOLA 1 to LOLA 2...`);
    const respUpgradeLink = await commonWell.upgradeOrDowngradePatientLink(
      queryMeta,
      link._links.upgrade.href
    );
    console.log(respUpgradeLink);
  }

  console.log(`>>> [E1c] Querying for docs...`);
  const respDocQuery = await commonWell.queryDocuments(queryMeta, patientId);
  // console.log(JSON.stringify(respDocQuery, undefined, 2));
  if (respDocQuery.entry.length > 0) {
    const docs = respDocQuery.entry;
    for (const doc of docs) {
      console.log(`... Now would download file from URL: ${doc.content.location}`);
    }
  }
}
