/**
 * Explicit skill registry. Add every skill here — the orchestrator registers
 * exactly this list with the model as callable tools, in this order.
 *
 * To add a skill: create skills/your-skill.ts exporting a `Skill`, import it here,
 * and append it to the array. That's the whole wiring.
 */
import type { AnySkill } from "@nera/contracts";
import { findPerson } from "./find-person.js";
import { findPlace } from "./find-place.js";
import { checkAppointment } from "./check-appointment.js";
import { navigateFloor } from "./navigate-floor.js";
import { humanFallback } from "./human-fallback.js";

export const skills = [findPerson, findPlace, checkAppointment, navigateFloor, humanFallback];
