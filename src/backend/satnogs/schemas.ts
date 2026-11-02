import { z } from 'zod'

export const transmitterSchema = z.object({
  uuid: z.string(),
  description: z.string().nullish(),
  alive: z.boolean(),
  type: z.string(),
  status: z.string(),
  sat_id: z.string(),
  norad_cat_id: z.number(),
  downlink_low: z.number().nullish(),
  mode: z.string().nullish(),
  baud: z.number().nullish(),
})

export const satelliteSchema = z.object({
  sat_id: z.string(),
  norad_cat_id: z.number(),
  name: z.string(),
  status: z.string(),
  decayed: z.string().nullish(),
  launched: z.string().nullish(),
  telemetries: z.array(z.object({ decoder: z.string() })).default([]),
})

export const observationSchema = z.object({
  id: z.number(),
  start: z.string(),
  status: z.string(),
  norad_cat_id: z.number(),
})

export type Transmitter = z.infer<typeof transmitterSchema>
export type Satellite = z.infer<typeof satelliteSchema>
export type Observation = z.infer<typeof observationSchema>

/** Parse an untrusted array, keeping the valid items and dropping the rest. */
export const parseItems = <T>(schema: z.ZodType<T>, data: unknown): readonly T[] =>
  Array.isArray(data)
    ? data.flatMap((item) => {
        const result = schema.safeParse(item)
        return result.success ? [result.data] : []
      })
    : []
