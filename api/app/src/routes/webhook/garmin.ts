import { MetriportData } from "@metriport/api/lib/models/metriport-data";
import { Request, Response } from "express";
import Router from "express-promise-router";
import { processData } from "../../command/webhook/webhook";
import { UserData } from "../../mappings/garmin";
import {
  garminActivityListSchema,
  mapToActivity,
} from "../../mappings/garmin/activity";
import {
  garminActivityDetailListSchema,
  mapToActivity as mapToActivityDetail,
} from "../../mappings/garmin/activity-detail";
import {
  garminBodyCompositionListSchema,
  mapToBody,
} from "../../mappings/garmin/body-composition";
import { garminSleepListSchema, mapToSleep } from "../../mappings/garmin/sleep";
import { Util } from "../../shared/util";
import { deregister, deregisterUsersSchema } from "../middlewares/oauth1";
import { asyncHandler } from "../util";

const routes = Router();

const log = Util.log(`GARMIN.Webhook`);

// TODO #34 #118 Finish and document
/** ---------------------------------------------------------------------------
 * POST /
 *
 * WEBHOOK CALL
 */
routes.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    // TODO #118 remove
    logRequest(req);
    // USER/AUTH related
    if (req.body.deregistrations) {
      await deregister(deregisterUsersSchema.parse(req.body.deregistrations));
    }
    // CONVERT
    const data = mapData(req.body);
    if (!data) {
      console.log(`Data mapping is empty, returning 200`);
      return res.sendStatus(200);
    }
    // STORE AND SEND TO CUSTOMER
    // Intentionally asynchronous, respond asap, sending to customers is irrelevant to Provider
    processData(data);

    return res.sendStatus(200);
  })
);

function mapData(body: any): UserData<MetriportData>[] | undefined {
  const results: UserData<MetriportData>[] = [];

  if (body.activities) {
    results.push(
      ...mapToActivity(garminActivityListSchema.parse(body.activities))
    );
  }
  if (body.activityDetails) {
    results.push(
      ...mapToActivityDetail(
        garminActivityDetailListSchema.parse(body.activityDetails)
      )
    );
  }
  if (body.sleeps) {
    results.push(...mapToSleep(garminSleepListSchema.parse(body.sleeps)));
  }
  if (body.bodyComps) {
    results.push(
      ...mapToBody(garminBodyCompositionListSchema.parse(body.bodyComps))
    );
  }

  if (!results || results.length < 1) {
    const msg = "Could not process the payload";
    log(msg + ": " + JSON.stringify(body));
    // failing silently for unexpected payloads
    return undefined;
  }
  return results;
}

function logRequest(req: Request): void {
  log(`Headers: ${JSON.stringify(req.headers, undefined, 2)}`);
  log(`Query: ${JSON.stringify(req.query, undefined, 2)}`);
  log(`BODY: ${JSON.stringify(req.body, undefined, 2)}`);
}

export default routes;
