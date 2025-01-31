import { z } from "zod";

// Not sure if we could replace 'any' by 'unknown' or an actual type. Disabling ESLint so we can deploy.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const googleResp = (googleActivityDataSourceId: any) => {
  return z.object({
    bucket: z.array(
      z.object({
        startTimeMillis: z.string(),
        endTimeMillis: z.string(),
        dataset: z.array(
          z.object({
            dataSourceId: googleActivityDataSourceId,
            point: googlePoint,
          })
        ),
      })
    ),
  });
};

export const googlePoint = z.array(
  z.object({
    startTimeNanos: z.string(),
    endTimeNanos: z.string(),
    dataTypeName: z.string(),
    originDataSourceId: z.string(),
    value: z.array(
      z.object({
        fpVal: z.number().optional(),
        intVal: z.number().optional(),
        mapVal: z.array(
          z.object({
            key: z.string(),
            value: z.object({ fpVal: z.number().optional() }),
          })
        ),
      })
    ),
  })
);

export type GooglePoint = z.infer<typeof googlePoint>;

const sessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  startTimeMillis: z.string(),
  endTimeMillis: z.string(),
  modifiedTimeMillis: z.string(),
  application: z.object({
    packageName: z.string(),
    version: z.string(),
    detailsUrl: z.string(),
  }),
  activityType: z.number(),
});

export const sessionResp = z.object({
  session: z.array(sessionSchema),
  deletedSession: z.array(sessionSchema),
});

export type GoogleSessions = z.infer<typeof sessionResp>;
