import { capitalize } from "lodash";
import z from "zod";

export const activityTypeSchema = z.enum([
  "RUNNING",
  "INDOOR_RUNNING",
  "OBSTACLE_RUN",
  "STREET_RUNNING",
  "TRACK_RUNNING",
  "TRAIL_RUNNING",
  "TREADMILL_RUNNING",
  "ULTRA_RUN",
  "VIRTUAL_RUN",
  "CYCLING",
  "BMX",
  "CYCLOCROSS",
  "DOWNHILL_BIKING",
  "E_BIKE_FITNESS",
  "E_BIKE_MOUNTAIN",
  "GRAVEL_CYCLING",
  "INDOOR_CYCLING",
  "MOUNTAIN_BIKING",
  "RECUMBENT_CYCLING",
  "ROAD_BIKING",
  "TRACK_CYCLING",
  "VIRTUAL_RIDE",
  "FITNESS_EQUIPMENT",
  "BOULDERING",
  "ELLIPTICAL",
  "INDOOR_CARDIO",
  "HIIT",
  "INDOOR_CLIMBING",
  "INDOOR_ROWING",
  "PILATES",
  "STAIR_CLIMBING",
  "STRENGTH_TRAINING",
  "YOGA29",
  "HIKING",
  "SWIMMING",
  "LAP_SWIMMING",
  "OPEN_WATER_SWIMMING",
  "WALKING",
  "CASUAL_WALKING",
  "SPEED_WALKING",
  "TRANSITION_V2",
  "BIKE_TO_RUN_TRANSITION_V2",
  "RUN_TO_BIKE_TRANSITION_V2",
  "SWIM_TO_BIKE_TRANSITION_V2",
  "MOTORCYCLING_V2",
  "ATV_V2",
  "MOTOCROSS_V2",
  "OTHER",
  "ASSISTANCE",
  "AUTO_RACING",
  "BOATING_V2",
  "BREATHWORK",
  "DISC_GOLF",
  "DRIVING_GENERAL",
  "E_SPORT",
  "FLOOR_CLIMBING",
  "FLYING",
  "GOLF",
  "HANG_GLIDING",
  "HORSEBACK_RIDING",
  "HUNTING_FISHING",
  "HUNTING_V2",
  "FISHING_V2",
  "INLINE_SKATING",
  "KAYAKING_V2",
  "KITEBOARDING_V2",
  "MOUNTAINEERIN",
  "OFFSHORE_GRINDING_V2",
  "ONSHORE_GRINDING_V2",
  "PADDLING_V230",
  "RC_DRONE",
  "ROCK_CLIMBING",
  "ROWING_V2",
  "SAILING_V2",
  "SKY_DIVING",
  "STAND_UP_PADDLEBOARDING",
  "STOP_WATCH",
  "SURFING_V2",
  "TENNIS",
  "RAFTING",
  "WAKEBOARDING",
  "WHITEWATER_RAFTING_KAYAKING",
  "WINDSURFING_V2",
  "WINGSUIT_FLYING",
  "DIVING",
  "APNEA_DIVING",
  "APNEA_HUNTING",
  "CCR_DIVING",
  "GAUGE_DIVING",
  "MULTI_GAS_DIVING",
  "SINGLE_GAS_DIVING",
  "WINTER_SPORTS",
  "BACKCOUNTRY_SNOWBOARDING",
  "BACKCOUNTRY_SKIING",
  "CROSS_COUNTRY_SKIING_WS",
  "RESORT_SKIING_SNOWBOARDING_WS",
  "SKATE_SKIING_WS",
  "SKATING_WS",
  "SNOW_SHOE_WS",
  "SNOWMOBILING_WS",
]);
export type ActivityType = z.infer<typeof activityTypeSchema>;

export const activityTypeMapping: Record<ActivityType, string> = {
  RUNNING: "RUNNING",
  INDOOR_RUNNING: "INDOOR RUNNING",
  OBSTACLE_RUN: "OBSTACLE RUNNING",
  STREET_RUNNING: "STREET RUNNING",
  TRACK_RUNNING: "TRACK RUNNING",
  TRAIL_RUNNING: "TRAIL RUNNING",
  TREADMILL_RUNNING: "TREADMILL RUNNING",
  ULTRA_RUN: "ULTRA RUNNING",
  VIRTUAL_RUN: "VIRTUAL RUNNING",
  CYCLING: "CYCLING",
  BMX: "BMX",
  CYCLOCROSS: "CYCLOCROSS",
  DOWNHILL_BIKING: "DOWNHILL BIKING",
  E_BIKE_FITNESS: "EBIKING",
  E_BIKE_MOUNTAIN: "EMOUNTAINBIKING",
  GRAVEL_CYCLING: "GRAVEL/UNPAVED CYCLING",
  INDOOR_CYCLING: "INDOOR CYCLING",
  MOUNTAIN_BIKING: "MOUNTAIN BIKING",
  RECUMBENT_CYCLING: "RECUMBENT CYCLING",
  ROAD_BIKING: "ROAD CYCLING",
  TRACK_CYCLING: "TRACK CYCLING",
  VIRTUAL_RIDE: "VIRTUAL CYCLING",
  FITNESS_EQUIPMENT: "GYM & FITNESS EQUIPMENT",
  BOULDERING: "BOULDERING",
  ELLIPTICAL: "ELLIPTICAL",
  INDOOR_CARDIO: "CARDIO",
  HIIT: "HIIT",
  INDOOR_CLIMBING: "INDOOR CLIMBING",
  INDOOR_ROWING: "INDOOR ROWING",
  PILATES: "PILATES",
  STAIR_CLIMBING: "STAIR STEPPER",
  STRENGTH_TRAINING: "STRENGTH TRAINING",
  YOGA29: "YOGA",
  HIKING: "HIKING",
  SWIMMING: "SWIMMING",
  LAP_SWIMMING: "POOL SWIMMING",
  OPEN_WATER_SWIMMING: "OPEN WATER SWIMMING",
  WALKING: "WALKING/INDOOR WALKING",
  CASUAL_WALKING: "CASUAL WALKING",
  SPEED_WALKING: "SPEED WALKING",
  TRANSITION_V2: "TRANSITION",
  BIKE_TO_RUN_TRANSITION_V2: "BIKE TO RUN TRANSITION",
  RUN_TO_BIKE_TRANSITION_V2: "RUN TO BIKE TRANSITION",
  SWIM_TO_BIKE_TRANSITION_V2: "SWIM TO BIKE TRANSITION",
  MOTORCYCLING_V2: "MOTORCYCLING",
  ATV_V2: "ATV",
  MOTOCROSS_V2: "MOTOCROSS",
  OTHER: "OTHER",
  ASSISTANCE: "ASSISTANCE",
  AUTO_RACING: "AUTO RACING",
  BOATING_V2: "BOATING BOATING",
  BREATHWORK: "BREATHWORK",
  DISC_GOLF: "DISC GOLF",
  DRIVING_GENERAL: "DRIVING",
  E_SPORT: "ESPORTS",
  FLOOR_CLIMBING: "FLOOR CLIMBING",
  FLYING: "FLYING",
  GOLF: "GOLF",
  HANG_GLIDING: "HANG GLIDING",
  HORSEBACK_RIDING: "HORSEBACK RIDING",
  HUNTING_FISHING: "HUNTING/FISHING",
  HUNTING_V2: "HUNTING HUNTING",
  FISHING_V2: "FISHING FISHING",
  INLINE_SKATING: "INLINE SKATING",
  KAYAKING_V2: "KAYAKING",
  KITEBOARDING_V2: "KITEBOARDING",
  MOUNTAINEERIN: "MOUNTAINEERING",
  OFFSHORE_GRINDING_V2: "OFFSHORE GRINDING",
  ONSHORE_GRINDING_V2: "ONSHORE GRINDING",
  PADDLING_V230: "PADDLING",
  RC_DRONE: "RC/DRONE",
  ROCK_CLIMBING: "ROCK CLIMBING",
  ROWING_V2: "ROWING ROWING",
  SAILING_V2: "SAILING SAILING",
  SKY_DIVING: "SKY DIVING",
  STAND_UP_PADDLEBOARDING: "STAND UP PADDLEBOARDING",
  STOP_WATCH: "STOPWATCH",
  SURFING_V2: "SURFING SURFING",
  TENNIS: "TENNIS",
  RAFTING: "RAFTING",
  WAKEBOARDING: "WAKEBOARDING",
  WHITEWATER_RAFTING_KAYAKING: "WHITEWATER KAYAKING/RAFTING",
  WINDSURFING_V2: "WIND SURFING",
  WINGSUIT_FLYING: "WINGSUIT FLYING",
  DIVING: "DIVING",
  APNEA_DIVING: "APNEA",
  APNEA_HUNTING: "APNEA HUNT",
  CCR_DIVING: "CCR DIVE",
  GAUGE_DIVING: "GAUGE DIVE",
  MULTI_GAS_DIVING: "MULTI-GAS DIVE",
  SINGLE_GAS_DIVING: "SINGLE-GAS DIVE",
  WINTER_SPORTS: "WINTER SPORTS",
  BACKCOUNTRY_SNOWBOARDING: "BACKCOUNTRY SNOWBOARDING",
  BACKCOUNTRY_SKIING: "BACKCOUNTRY SKIING",
  CROSS_COUNTRY_SKIING_WS: "CROSS COUNTRY CLASSIC SKIING",
  RESORT_SKIING_SNOWBOARDING_WS: "RESORT SKIING/SNOWBOARDING",
  SKATE_SKIING_WS: "CROSS COUNTRY SKATE SKIING",
  SKATING_WS: "SKATING",
  SNOW_SHOE_WS: "SNOWSHOEING",
  SNOWMOBILING_WS: "SNOWMOBILING",
};

export const activityTypeReadable = (theType: ActivityType) =>
  capitalize(activityTypeMapping[theType]);
