import { Sample } from "@metriport/api/lib/devices/models/common/sample";
import convert from "convert-units";
import crypto from "crypto";
import { mean } from "lodash";
import { PassThrough } from "node:stream";
import { debug } from "./log";

interface MinMaxItem {
  min_item: number;
  max_item: number;
}
export class Util {
  static isTokenExpired(expires_at: number): boolean {
    const bufferSeconds = 600;

    return (
      convert(expires_at).from("s").to("ms") -
        Date.now() +
        convert(bufferSeconds).from("s").to("ms") <=
      0
    );
  }

  static md5(value: string): string {
    return crypto.createHash("md5").update(value).digest("hex");
  }

  static curSecSinceEpoch(): number {
    const now = new Date();
    const utcMilllisecondsSinceEpoch = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
    return Math.round(utcMilllisecondsSinceEpoch / 1000);
  }

  static getMinMaxItem = (arr: number[]): MinMaxItem => {
    const min_item = Math.min(...arr);
    const max_item = Math.max(...arr);

    return {
      min_item,
      max_item,
    };
  };

  static getAvgOfArr = (arr: number[], fixed = 0): number => {
    if (arr.length) {
      const average = mean(arr);
      return Number(average.toFixed(fixed));
    }

    return 0;
  };

  static getAvgOfSamplesArr = (arr: Sample[], fixed = 0): number => {
    return this.getAvgOfArr(
      arr.map(sample => sample.value),
      fixed
    );
  };

  static getMinMaxSamplesItem = (arr: Sample[]): MinMaxItem => {
    return this.getMinMaxItem(arr.map(sample => sample.value));
  };

  static addDataToObject = (key: string, value: unknown) => {
    if (value) {
      return { [key]: value };
    }
    return undefined;
  };

  static log =
    (prefix: string) =>
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    (msg: string, ...optionalParams: any[]): void =>
      optionalParams
        ? console.log(`[${prefix}] ${msg}`, ...optionalParams)
        : console.log(`[${prefix}] ${msg}`);

  static debug =
    (prefix: string) =>
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    (msg: string, ...optionalParams: any[]): void =>
      debug(`[${prefix}] ${msg}`, ...optionalParams);

  static out = (prefix: string) => ({
    log: Util.log(prefix),
    debug: Util.debug(prefix),
  });

  static sleep = (timeInMs: number) => new Promise(resolve => setTimeout(resolve, timeInMs));

  static async sleepRandom(max: number, multiplierMin = 0.1): Promise<void> {
    let multiplier = Math.random();
    if (multiplier < multiplierMin) multiplier += multiplierMin; // at least 10% of the max delay
    const timeToWait = Math.floor(multiplier * max);
    await Util.sleep(timeToWait);
  }

  static kilojoulesToKilocalories(kilojoules: number): number {
    return kilojoules * 0.239006;
  }

  /**
   * Converts the parameter to undefined if its null, or return
   * it if present.
   * The return type is the original or undefined, can't return null.
   */
  static optional = <T>(v: T): NonNullable<T> | undefined => (v != null ? v : undefined);

  /**
   * Returns the first non-null and non-undefined item in the array,
   * or undefined.
   */
  static oneOf = <T>(...values: T[]): NonNullable<T> | undefined =>
    values.find(v => v != null) ?? undefined;

  static async streamToString(stream: PassThrough): Promise<string> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
      stream.on("error", err => reject(err));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }
}
