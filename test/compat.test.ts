import assert from "node:assert/strict";
import { test } from "node:test";

import {
	SUPPORTED_PI_MAX_EXCLUSIVE,
	SUPPORTED_PI_MIN,
	compareVersions,
	isSupportedPiVersion,
	parseVersionParts,
} from "../src/compat.ts";

test("parseVersionParts pads missing parts with zero", () => {
	assert.deepEqual(parseVersionParts("0.84"), [0, 84, 0]);
	assert.deepEqual(parseVersionParts("v1.2.3"), [1, 2, 3]);
});

test("parseVersionParts rejects junk", () => {
	assert.equal(parseVersionParts(""), undefined);
	assert.equal(parseVersionParts("abc"), undefined);
	assert.equal(parseVersionParts("1.2.3.4"), undefined);
});

test("compareVersions orders correctly", () => {
	assert.equal(compareVersions("0.84.2", "0.84.2"), 0);
	assert.equal(compareVersions("0.84.1", "0.84.2"), -1);
	assert.equal(compareVersions("0.84.10", "0.84.9"), 1);
});

test("gate matches only the supported range", () => {
	assert.equal(isSupportedPiVersion("0.84.1"), false);
	assert.equal(isSupportedPiVersion("0.84.2"), true);
	assert.equal(isSupportedPiVersion("0.84.4"), true);
	assert.equal(isSupportedPiVersion("0.85.0"), false);
	assert.equal(isSupportedPiVersion("not-a-version"), false);
});

test("supported range constants stay consistent", () => {
	assert.equal(compareVersions(SUPPORTED_PI_MIN, SUPPORTED_PI_MAX_EXCLUSIVE) < 0, true);
});
