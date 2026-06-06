/**
 * Explicit skill registry. Add every skill here — the orchestrator registers
 * exactly this list with the model as callable tools, in this order.
 *
 * To add a skill: create skills/your-skill.ts exporting a `Skill`, import it here,
 * and append it to the array. That's the whole wiring.
 */
import type { AnySkill } from "../contracts/skill.js";
import { findPerson } from "./find-person.js";
import { findPlace } from "./find-place.js";

export const skills: AnySkill[] = [
  findPlace, // most common: direct room/zone/event match
  findPerson, // person -> their location
];
