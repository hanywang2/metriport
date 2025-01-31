import { FhirAdminClient, FhirClient } from "./api";
import { HapiFhirAdminClient, HapiFhirClient } from "./api-hapi";

/**
 * Return an instance of the FHIR API client configured to access the respective
 * customer's data.
 */
export const makeFhirApi = (cxId: string): FhirClient => new HapiFhirClient(cxId);

/**
 * WARNING: THIS IS FOR TENANT MANAGEMENT ONLY!
 *
 * Returns an instance of the FHIR API client configured to access the
 * default tenant, which can be used to manage tenants on the FHIR server.
 */
export const makeFhirAdminApi = (): FhirAdminClient => new HapiFhirAdminClient();
