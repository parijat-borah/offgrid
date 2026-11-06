import typesJson from "@data/traveller-types.json";
import { TravellerTypesSchema } from "@offgrid/core";

/** Small static content, bundled with the app (the server scores the quiz again on submit). */
export const TRAVELLER_TYPES = TravellerTypesSchema.parse(typesJson);

export const typeById = (id: string | null | undefined) => TRAVELLER_TYPES.types.find((t) => t.id === id) ?? null;
