import {pathToFileURL} from "node:url";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {PHONE_REPAIR_TOURNAMENT_ID, runRegistrationPhoneRepair} from "../registrationPhoneRepair.js";

export const parsePhoneRepairArgs = (args: string[]) => {
    const value = (flag: string): string => {
        const index = args.indexOf(flag);
        return index >= 0 ? (args[index + 1] ?? "").trim() : "";
    };
    const known = new Set(["--database", "--tournament", "--repair-id", "--apply", "--restore"]);
    for (let index = 0; index < args.length; index += 1) {
        if (!known.has(args[index])) throw new Error("Unknown argument.");
        if (["--database", "--tournament", "--repair-id"].includes(args[index])) {
            if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Missing argument value.");
            index += 1;
        }
    }
    if (value("--database") !== "(default)" || value("--tournament") !== PHONE_REPAIR_TOURNAMENT_ID) {
        throw new Error("Explicit --database '(default)' and --tournament qzhR8w2Zs7MNUtlycL9N required.");
    }
    const repairId = value("--repair-id") || `registration-phones-${PHONE_REPAIR_TOURNAMENT_ID}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(repairId)) throw new Error("Invalid repair ID.");
    return {
        tournamentId: PHONE_REPAIR_TOURNAMENT_ID,
        repairId,
        apply: args.includes("--apply"),
        restore: args.includes("--restore"),
    };
};

const main = async (): Promise<void> => {
    const options = parsePhoneRepairArgs(process.argv.slice(2));
    const app = getApps()[0] ?? initializeApp({projectId: "sport-stacking-website"});
    const db = getFirestore(app);
    const report = await runRegistrationPhoneRepair(db, options);
    process.stdout.write(
        `${JSON.stringify({...report, counts: Object.fromEntries(Object.entries(report.records).map(([key, ids]) => [key, ids.length]))}, null, 2)}\n`,
    );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(() => {
        process.stderr.write("Registration phone repair failed; inspect credentials and server logs. No contact data logged.\n");
        process.exitCode = 1;
    });
}
