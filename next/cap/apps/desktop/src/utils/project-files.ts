export function projectAssetPath(project: string, stored: string) {
	const clean = stored
		.replace("asset://localhost/", "/")
		.replace("asset://", "")
		.replace("localhost//", "/");
	if (/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(clean)) return clean;
	return `${project.replace(/[\\/]+$/, "")}/${clean}`;
}

export function projectCopyName(title: string) {
	const cleaned = [...title.replace(/\.(?:jks|cap|jianku)$/i, "")]
		.map((character) =>
			character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
				? "_"
				: character,
		)
		.join("")
		.trim();
	let name = "";
	for (const character of cleaned) {
		if (new TextEncoder().encode(name + character).length > 180) break;
		name += character;
	}
	return `${name || "简库工程"} 副本.jks`;
}

export function isProjectPath(path: string) {
	return /\.(?:jks|cap)$/i.test(path.replace(/[\\/]+$/, ""));
}
