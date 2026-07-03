import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");
}

export async function POST(req: Request) {
  try {
    const project = await req.json();

    const topic = project.topic || "isimsiz-proje";

    const folder = path.join(process.cwd(), "data", "projects");

    fs.mkdirSync(folder, { recursive: true });

    const filename = `${slugify(topic)}.json`;

    const filePath = path.join(folder, filename);

    fs.writeFileSync(
      filePath,
      JSON.stringify(project, null, 2),
      "utf8"
    );

    return NextResponse.json({
      success: true,
      file: filename,
    });
  } catch (err) {
    console.error("SAVE PROJECT ERROR:", err);

    return NextResponse.json(
      {
        success: false,
        error: String(err),
      },
      {
        status: 500,
      }
    );
  }
}