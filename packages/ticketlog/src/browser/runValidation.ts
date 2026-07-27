import "dotenv/config";
import { normalizePlate } from "@ticketlog/domain";
import { BrowserTicketLogValidator, defaultValidationOutputPath } from "./validation.js";

const plate = normalizePlate(process.env.TICKETLOG_VALIDATE_PLATE ?? process.argv[2] ?? "");

if (!plate) {
  console.error("TICKETLOG_VALIDATE_PLATE is required");
  process.exit(1);
}

const outputPath = process.env.TICKETLOG_VALIDATION_OUTPUT_PATH ?? defaultValidationOutputPath();
const report = await new BrowserTicketLogValidator().validateReadOnly({
  vehiclePlate: plate,
  outputPath,
});

console.log(JSON.stringify({ result: report.result, outputPath, steps: report.steps }, null, 2));

if (report.result !== "PASSED") {
  process.exit(1);
}
