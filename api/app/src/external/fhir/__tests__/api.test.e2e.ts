import { v4 as uuidv4 } from "uuid";
import { makeOrgNumber } from "../../../models/medical/__tests__/organization";
import { makeAdminFhirApi } from "../api";

const fhirApi = makeAdminFhirApi();

describe("Integration FHIR Client", () => {
  describe("tenant", () => {
    const organizationNumber = makeOrgNumber();
    const cxId = uuidv4();

    test("create tenant", async () => {
      await expect(fhirApi.createTenant({ organizationNumber, cxId })).resolves.not.toThrow();
    });

    test("list tenants", async () => {
      const tenants = await fhirApi.listTenants();
      expect(tenants).toEqual(expect.arrayContaining([cxId]));
    });

    test("delete tenant", async () => {
      await expect(fhirApi.deleteTenant({ organizationNumber })).resolves.not.toThrow();
    });
  });
});
