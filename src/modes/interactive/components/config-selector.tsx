/**
 * React/opentui component for managing package resources (enable/disable).
 * Used by `pi config` command.
 */

import { basename, dirname, join, relative } from "node:path";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONFIG_DIR_NAME } from "../../../config.js";
import type { PathMetadata, ResolvedPaths, ResolvedResource } from "../../../core/package-manager.js";
import type { PackageSource, SettingsManager } from "../../../core/settings-manager.js";
import { theme } from "../theme/theme.js";

type ResourceType = "extensions" | "skills" | "prompts" | "themes";

const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
	extensions: "Extensions",
	skills: "Skills",
	prompts: "Prompts",
	themes: "Themes",
};

interface ResourceItem {
	path: string;
	enabled: boolean;
	metadata: PathMetadata;
	resourceType: ResourceType;
	displayName: string;
	groupKey: string;
	subgroupKey: string;
}

interface ResourceSubgroup {
	type: ResourceType;
	label: string;
	items: ResourceItem[];
}

interface ResourceGroup {
	key: string;
	label: string;
	scope: "user" | "project" | "temporary";
	origin: "package" | "top-level";
	source: string;
	subgroups: ResourceSubgroup[];
}

function getGroupLabel(metadata: PathMetadata): string {
	if (metadata.origin === "package") {
		return `${metadata.source} (${metadata.scope})`;
	}
	if (metadata.source === "auto") {
		return metadata.scope === "user" ? "User (~/.pi/agent/)" : "Project (.pi/)";
	}
	return metadata.scope === "user" ? "User settings" : "Project settings";
}

function buildGroups(resolved: ResolvedPaths): ResourceGroup[] {
	const groupMap = new Map<string, ResourceGroup>();

	const addToGroup = (resources: ResolvedResource[], resourceType: ResourceType) => {
		for (const res of resources) {
			const { path, enabled, metadata } = res;
			const groupKey = `${metadata.origin}:${metadata.scope}:${metadata.source}`;

			if (!groupMap.has(groupKey)) {
				groupMap.set(groupKey, {
					key: groupKey,
					label: getGroupLabel(metadata),
					scope: metadata.scope,
					origin: metadata.origin,
					source: metadata.source,
					subgroups: [],
				});
			}

			const group = groupMap.get(groupKey)!;

			let subgroup = group.subgroups.find((sg) => sg.type === resourceType);
			if (!subgroup) {
				subgroup = {
					type: resourceType,
					label: RESOURCE_TYPE_LABELS[resourceType],
					items: [],
				};
				group.subgroups.push(subgroup);
			}

			const fileName = basename(path);
			const parentFolder = basename(dirname(path));
			let displayName: string;
			if (resourceType === "extensions" && parentFolder !== "extensions") {
				displayName = `${parentFolder}/${fileName}`;
			} else if (resourceType === "skills" && fileName === "SKILL.md") {
				displayName = parentFolder;
			} else {
				displayName = fileName;
			}
			subgroup.items.push({
				path,
				enabled,
				metadata,
				resourceType,
				displayName,
				groupKey,
				subgroupKey: `${groupKey}:${resourceType}`,
			});
		}
	};

	addToGroup(resolved.extensions, "extensions");
	addToGroup(resolved.skills, "skills");
	addToGroup(resolved.prompts, "prompts");
	addToGroup(resolved.themes, "themes");

	const groups = Array.from(groupMap.values());
	groups.sort((a, b) => {
		if (a.origin !== b.origin) {
			return a.origin === "package" ? -1 : 1;
		}
		if (a.scope !== b.scope) {
			return a.scope === "user" ? -1 : 1;
		}
		return a.source.localeCompare(b.source);
	});

	const typeOrder: Record<ResourceType, number> = { extensions: 0, skills: 1, prompts: 2, themes: 3 };
	for (const group of groups) {
		group.subgroups.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);
		for (const subgroup of group.subgroups) {
			subgroup.items.sort((a, b) => a.displayName.localeCompare(b.displayName));
		}
	}

	return groups;
}

type FlatEntry =
	| { type: "group"; group: ResourceGroup }
	| { type: "subgroup"; subgroup: ResourceSubgroup; group: ResourceGroup }
	| { type: "item"; item: ResourceItem };

function buildFlatList(groups: ResourceGroup[]): FlatEntry[] {
	const flat: FlatEntry[] = [];
	for (const group of groups) {
		flat.push({ type: "group", group });
		for (const subgroup of group.subgroups) {
			flat.push({ type: "subgroup", subgroup, group });
			for (const item of subgroup.items) {
				flat.push({ type: "item", item });
			}
		}
	}
	return flat;
}

function filterFlatItems(flatItems: FlatEntry[], query: string, groups: ResourceGroup[]): FlatEntry[] {
	if (!query.trim()) return [...flatItems];

	const lowerQuery = query.toLowerCase();
	const matchingItems = new Set<ResourceItem>();
	const matchingSubgroups = new Set<ResourceSubgroup>();
	const matchingGroups = new Set<ResourceGroup>();

	for (const entry of flatItems) {
		if (entry.type === "item") {
			const item = entry.item;
			if (
				item.displayName.toLowerCase().includes(lowerQuery) ||
				item.resourceType.toLowerCase().includes(lowerQuery) ||
				item.path.toLowerCase().includes(lowerQuery)
			) {
				matchingItems.add(item);
			}
		}
	}

	for (const group of groups) {
		for (const subgroup of group.subgroups) {
			for (const item of subgroup.items) {
				if (matchingItems.has(item)) {
					matchingSubgroups.add(subgroup);
					matchingGroups.add(group);
				}
			}
		}
	}

	return flatItems.filter((entry) => {
		if (entry.type === "group") return matchingGroups.has(entry.group);
		if (entry.type === "subgroup") return matchingSubgroups.has(entry.subgroup);
		return matchingItems.has(entry.item);
	});
}

function findNextItemIndex(items: FlatEntry[], from: number, direction: 1 | -1): number {
	let idx = from + direction;
	while (idx >= 0 && idx < items.length) {
		if (items[idx].type === "item") return idx;
		idx += direction;
	}
	return from;
}

function toggleResource(
	item: ResourceItem,
	enabled: boolean,
	settingsManager: SettingsManager,
	cwd: string,
	agentDir: string,
): void {
	if (item.metadata.origin === "top-level") {
		toggleTopLevelResource(item, enabled, settingsManager, cwd, agentDir);
	} else {
		togglePackageResource(item, enabled, settingsManager);
	}
}

function toggleTopLevelResource(
	item: ResourceItem,
	enabled: boolean,
	settingsManager: SettingsManager,
	cwd: string,
	agentDir: string,
): void {
	const scope = item.metadata.scope as "user" | "project";
	const settings = scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();

	const arrayKey = item.resourceType as "extensions" | "skills" | "prompts" | "themes";
	const current = (settings[arrayKey] ?? []) as string[];

	const baseDir = scope === "project" ? join(cwd, CONFIG_DIR_NAME) : agentDir;
	const pattern = relative(baseDir, item.path);

	const updated = current.filter((p) => {
		const stripped = p.startsWith("!") || p.startsWith("+") || p.startsWith("-") ? p.slice(1) : p;
		return stripped !== pattern;
	});

	if (enabled) {
		updated.push(`+${pattern}`);
	} else {
		updated.push(`-${pattern}`);
	}

	if (scope === "project") {
		if (arrayKey === "extensions") settingsManager.setProjectExtensionPaths(updated);
		else if (arrayKey === "prompts") settingsManager.setProjectPromptTemplatePaths(updated);
		else if (arrayKey === "themes") settingsManager.setProjectThemePaths(updated);
	} else {
		if (arrayKey === "extensions") settingsManager.setExtensionPaths(updated);
		else if (arrayKey === "prompts") settingsManager.setPromptTemplatePaths(updated);
		else if (arrayKey === "themes") settingsManager.setThemePaths(updated);
	}
}

function togglePackageResource(item: ResourceItem, enabled: boolean, settingsManager: SettingsManager): void {
	const scope = item.metadata.scope as "user" | "project";
	const settings = scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();

	const packages = [...(settings.packages ?? [])] as PackageSource[];
	const pkgIndex = packages.findIndex((pkg) => {
		const source = typeof pkg === "string" ? pkg : pkg.source;
		return source === item.metadata.source;
	});

	if (pkgIndex === -1) return;

	let pkg = packages[pkgIndex];
	if (typeof pkg === "string") {
		pkg = { source: pkg };
		packages[pkgIndex] = pkg;
	}

	const arrayKey = item.resourceType as "extensions" | "skills" | "prompts" | "themes";
	const current = (pkg[arrayKey] ?? []) as string[];
	const baseDir = item.metadata.baseDir ?? dirname(item.path);
	const pattern = relative(baseDir, item.path);

	const updated = current.filter((p) => {
		const stripped = p.startsWith("!") || p.startsWith("+") || p.startsWith("-") ? p.slice(1) : p;
		return stripped !== pattern;
	});

	if (enabled) {
		updated.push(`+${pattern}`);
	} else {
		updated.push(`-${pattern}`);
	}

	(pkg as Record<string, unknown>)[arrayKey] = updated.length > 0 ? updated : undefined;

	const hasFilters = ["extensions", "skills", "prompts", "themes"].some(
		(k) => (pkg as Record<string, unknown>)[k] !== undefined,
	);
	if (!hasFilters) {
		packages[pkgIndex] = (pkg as { source: string }).source;
	}

	if (scope === "project") {
		settingsManager.setProjectPackages(packages);
	} else {
		settingsManager.setPackages(packages);
	}
}

const MAX_VISIBLE = 15;

export interface ConfigSelectorProps {
	resolvedPaths: ResolvedPaths;
	settingsManager: SettingsManager;
	cwd: string;
	agentDir: string;
	onClose: () => void;
	onExit: () => void;
}

export function ConfigSelectorComponent({
	resolvedPaths,
	settingsManager,
	cwd,
	agentDir,
	onClose,
	onExit,
}: ConfigSelectorProps): React.ReactNode {
	const { width: termWidth } = useTerminalDimensions();
	const [searchQuery, setSearchQuery] = useState("");
	const [, forceUpdate] = useState(0);
	const groups = useMemo(() => buildGroups(resolvedPaths), [resolvedPaths]);
	const flatItems = useMemo(() => buildFlatList(groups), [groups]);
	const selectedIndexRef = useRef(0);

	const filteredItems = useMemo(
		() => filterFlatItems(flatItems, searchQuery, groups),
		[flatItems, searchQuery, groups],
	);

	const selectedIndex = selectedIndexRef.current;

	const findFirstItem = useCallback((items: FlatEntry[]): number => {
		const idx = items.findIndex((e) => e.type === "item");
		return idx >= 0 ? idx : 0;
	}, []);

	useEffect(() => {
		selectedIndexRef.current = findFirstItem(filteredItems);
		forceUpdate((n) => n + 1);
	}, [findFirstItem, filteredItems]);

	useKeyboard(
		useCallback(
			(key) => {
				if (key.name === "up") {
					selectedIndexRef.current = findNextItemIndex(filteredItems, selectedIndexRef.current, -1);
					forceUpdate((n) => n + 1);
				} else if (key.name === "down") {
					selectedIndexRef.current = findNextItemIndex(filteredItems, selectedIndexRef.current, 1);
					forceUpdate((n) => n + 1);
				} else if (key.name === "pageup") {
					let target = Math.max(0, selectedIndexRef.current - MAX_VISIBLE);
					while (target < filteredItems.length && filteredItems[target].type !== "item") target++;
					if (target < filteredItems.length) selectedIndexRef.current = target;
					forceUpdate((n) => n + 1);
				} else if (key.name === "pagedown") {
					let target = Math.min(filteredItems.length - 1, selectedIndexRef.current + MAX_VISIBLE);
					while (target >= 0 && filteredItems[target].type !== "item") target--;
					if (target >= 0) selectedIndexRef.current = target;
					forceUpdate((n) => n + 1);
				} else if (key.name === "escape") {
					onClose();
				} else if (key.name === "c" && key.ctrl) {
					onExit();
				} else if (key.name === "space") {
					const entry = filteredItems[selectedIndexRef.current];
					if (entry?.type === "item") {
						const newEnabled = !entry.item.enabled;
						entry.item.enabled = newEnabled;
						toggleResource(entry.item, newEnabled, settingsManager, cwd, agentDir);
						forceUpdate((n) => n + 1);
					}
				} else if (key.name === "return") {
					const entry = filteredItems[selectedIndexRef.current];
					if (entry?.type === "item") {
						const newEnabled = !entry.item.enabled;
						entry.item.enabled = newEnabled;
						toggleResource(entry.item, newEnabled, settingsManager, cwd, agentDir);
						forceUpdate((n) => n + 1);
					}
				} else if (key.name === "backspace") {
					setSearchQuery((q) => q.slice(0, -1));
				} else if (key.name === "delete") {
					setSearchQuery((q) => q.slice(0, -1));
				} else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
					setSearchQuery((q) => q + key.sequence);
				}
			},
			[filteredItems, onClose, onExit, settingsManager, cwd, agentDir],
		),
	);

	const _width = termWidth - 4;
	const startIndex = Math.max(
		0,
		Math.min(selectedIndex - Math.floor(MAX_VISIBLE / 2), filteredItems.length - MAX_VISIBLE),
	);
	const endIndex = Math.min(startIndex + MAX_VISIBLE, filteredItems.length);

	const visibleEntries = filteredItems.slice(startIndex, endIndex);

	const searchHint =
		theme.fg("dim", "space") + theme.fg("muted", " toggle  ") + theme.fg("dim", "esc") + theme.fg("muted", " close");

	const lines: React.ReactNode[] = [];

	for (let i = 0; i < visibleEntries.length; i++) {
		const entry = visibleEntries[i];
		const globalIdx = startIndex + i;
		const isSelected = globalIdx === selectedIndex;

		if (entry.type === "group") {
			lines.push(
				React.createElement("text", { key: `g-${entry.group.key}`, fg: "#888888" }, `  ${entry.group.label}`),
			);
		} else if (entry.type === "subgroup") {
			lines.push(
				React.createElement(
					"text",
					{ key: `sg-${entry.subgroup.type}-${entry.subgroup.label}`, fg: "#666666" },
					`    ${entry.subgroup.label}`,
				),
			);
		} else {
			const item = entry.item;
			const cursor = isSelected ? "> " : "  ";
			const checkbox = item.enabled ? "[x]" : "[ ]";
			const checkboxColor = item.enabled ? "#22cc22" : "#666666";
			const name = item.displayName;

			lines.push(
				React.createElement(
					"box",
					{ key: `i-${item.path}`, flexDirection: "row" },
					React.createElement("text", {}, cursor),
					React.createElement("text", {}, "    "),
					React.createElement("text", { fg: checkboxColor }, checkbox),
					React.createElement("text", {}, " "),
					isSelected ? React.createElement("text", { bold: true }, name) : React.createElement("text", {}, name),
				),
			);
		}
	}

	const scrollIndicator =
		startIndex > 0 || endIndex < filteredItems.length
			? React.createElement("text", { fg: "#666666" }, `  (${selectedIndex + 1}/${filteredItems.length})`)
			: undefined;

	return React.createElement(
		"box",
		{
			flexDirection: "column",
			padding: 1,
			border: true,
			borderStyle: "single",
			borderColor: "#444444",
		},
		React.createElement(
			"box",
			{ flexDirection: "row", justifyContent: "space-between" },
			React.createElement("text", { bold: true }, "Resource Configuration"),
			React.createElement("text", { fg: "#666666" }, searchHint),
		),
		React.createElement("text", { fg: "#666666" }, "Type to filter resources"),
		React.createElement(
			"box",
			{ flexDirection: "row" },
			React.createElement("text", { fg: "#888888" }, "Search: "),
			React.createElement("text", {}, searchQuery || "(type to filter)"),
		),
		React.createElement("text", {}, ""),
		...lines,
		scrollIndicator,
	);
}
