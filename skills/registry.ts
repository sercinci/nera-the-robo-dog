// © Gerald Pögl / Hunter-ID MemoryBlock BG FlexCo (FN 658892i)
// Skill registry — import and register all skills here.

import { findPerson } from "./find-person.js";
import { findPlace } from "./find-place.js";
import { checkAppointment } from "./check-appointment.js";
import { navigateFloor } from "./navigate-floor.js";

export const skills = [findPerson, findPlace, checkAppointment, navigateFloor];
