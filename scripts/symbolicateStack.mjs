#!/usr/bin/env node

import {readFile} from "node:fs/promises";
import path from "node:path";
import {SourceMapConsumer} from "source-map";

const [mapFile, lineArg, columnArg] = process.argv.slice(2);
if (!mapFile || !lineArg || !columnArg) {
    console.error("Usage: yarn symbolicate <bundle.js.map> <line> <column>");
    process.exitCode = 1;
} else {
    const line = Number.parseInt(lineArg, 10);
    const column = Number.parseInt(columnArg, 10);
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 0) {
        throw new Error("Line must be >= 1 and column must be >= 0.");
    }

    const sourceMap = JSON.parse(await readFile(mapFile, "utf8"));
    const consumer = await new SourceMapConsumer(sourceMap);
    const position = consumer.originalPositionFor({line, column});
    const source = position.source
        ? path.normalize(path.resolve(path.dirname(mapFile), sourceMap.sourceRoot ?? "", position.source))
        : null;
    console.info(
        JSON.stringify(
            {
                generated: {line, column},
                source,
                originalLine: position.line,
                originalColumn: position.column,
                name: position.name,
            },
            null,
            2,
        ),
    );
    consumer.destroy?.();
}
