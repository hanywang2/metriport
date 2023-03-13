import { Request, Response } from "express";
import Router from "express-promise-router";
import status from "http-status";

import { asyncHandler, getCxIdOrFail, getFromParamsOrFail } from "../util";
import { getPatientWithDependencies } from "../../command/medical/patient/get-patient";
import cwCommands from "../../external/commonwell";
import { MedicalDataSource } from "../../external";
import { linkCreateSchema } from "./schemas/link";
import { dtoFromCW, PatientLinks } from "./dtos/linkDTO";

const router = Router();
/** ---------------------------------------------------------------------------
 * POST /patient/:patientId/link/:source
 *
 * Creates link to the specified entity.
 * @param   req.params.patientId   Patient ID to link to a person.
 * @param   req.params.source      HIE from where the link is made too.
 * @param   req.body.entityId      Person ID to link to the patient.
 *
 * @return  200
 */
router.post(
  "/:patientId/link/:source",
  asyncHandler(async (req: Request, res: Response) => {
    const cxId = getCxIdOrFail(req);
    const patientId = getFromParamsOrFail("patientId", req);
    const linkSource = getFromParamsOrFail("source", req);
    const linkCreate = linkCreateSchema.parse(req.body);

    const { patient, organization } = await getPatientWithDependencies({ id: patientId, cxId });

    if (linkSource === MedicalDataSource.COMMONWELL) {
      await cwCommands.link.create(linkCreate.entityId, patient, organization);
    }

    return res.sendStatus(status.OK);
  })
);

/** ---------------------------------------------------------------------------
 * DELETE /patient/:patientId/link/:source
 *
 * Removes the specified HIE link from the specified patient.
 * @param   req.params.patientId     Patient ID to remove link from.
 * @param   req.params.linkSource    HIE to remove the link from.
 * @return  200
 */
router.delete(
  "/:patientId/link/:source",
  asyncHandler(async (req: Request, res: Response) => {
    const cxId = getCxIdOrFail(req);
    const patientId = getFromParamsOrFail("patientId", req);
    const { patient, organization } = await getPatientWithDependencies({ id: patientId, cxId });
    const linkSource = req.params.source;

    if (linkSource === MedicalDataSource.COMMONWELL) {
      await cwCommands.link.reset(patient, organization);
    }

    return res.sendStatus(status.OK);
  })
);

/** ---------------------------------------------------------------------------
 * GET /patient/:patientId/link
 *
 * Builds and returns the current state of a patient's links across HIEs.
 *
 * @param   req.params.patientId     Patient ID for which to retrieve links.
 * @return  {PatientLinks}          The patient's current and potential links.
 */
router.get(
  "/:patientId/link",
  asyncHandler(async (req: Request, res: Response) => {
    const cxId = getCxIdOrFail(req);
    const patientId = getFromParamsOrFail("patientId", req);

    const { patient, organization } = await getPatientWithDependencies({ id: patientId, cxId });

    const links: PatientLinks = {
      currentLinks: [],
      potentialLinks: [],
    };

    const cwPersonLinks = await cwCommands.link.get(patient, organization);
    const cwConvertedLinks = dtoFromCW({
      cwPotentialPersons: cwPersonLinks.potentialLinks,
      cwCurrentPersons: cwPersonLinks.currentLinks,
    });

    links.potentialLinks = [...cwConvertedLinks.potentialLinks];
    links.currentLinks = [...cwConvertedLinks.currentLinks];

    return res.status(status.OK).json(links);
  })
);

export default router;
