import { NextFunction, Request } from "express";
import { ApiTypes, reportUsage as reportUsageCmd } from "../../command/usage/report-usage";
import { capture } from "../../shared/notifications";
import { Util } from "../../shared/util";
import { getUserIdFrom } from "../schemas/user-id";
import { getCxId } from "../util";

const log = Util.log("USAGE");

/**
 * Adds a listener on Response close/finish, executing the logic on 'reportIt'.
 * Thanks to https://stackoverflow.com/questions/20175806/before-and-after-hooks-for-a-request-in-express-to-be-executed-before-any-req-a
 */
export const reportUsage = (apiType: ApiTypes) => {
  return async (
    req: Request,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res: any, // otherwise we get type error, those Response functions are not mapped on Typescript
    next: NextFunction
  ): Promise<void> => {
    function afterResponse() {
      res.removeListener("finish", afterResponse);
      res.removeListener("close", afterResponse);
      reportIt(req, apiType);
    }
    res.on("finish", afterResponse);
    res.on("close", afterResponse);
    next();
  };
};

export const reportMedicalUsage = reportUsage(ApiTypes.medical);
export const reportDeviceUsage = reportUsage(ApiTypes.devices);
/**
 * Reports usage base on the the customer ID on the Request, property 'cxId', and
 * the customer's userId on the request params, 'userId'.
 */
const reportIt = async (req: Request, apiType: ApiTypes): Promise<void> => {
  try {
    const cxId = getCxId(req);
    if (!cxId) {
      log(`Skipped, missing cxId`);
      return;
    }
    const cxUserId = getUserIdFrom("query", req).optional();
    await reportUsageCmd({ cxId, cxUserId, apiType });
  } catch (err) {
    capture.error(err, { extra: { apiType } });
    // intentionally failing silently
  }
};
