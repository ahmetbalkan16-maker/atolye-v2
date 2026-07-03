import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    const folder = path.join(process.cwd(), "data", "projects");

    if (!fs.existsSync(folder)) {
      return NextResponse.json({
        success: true,
        projects: [],
      });
    }

    const files = fs.readdirSync(folder);

    const projects = files
      .filter((f) => f.endsWith(".json"))
      .map((file) => {
        const filePath = path.join(folder, file);

        const json = JSON.parse(
          fs.readFileSync(filePath, "utf8")
        );

        return {
          file,
          topic: json.topic,
          summary: json.summary,
        };
      });

    return NextResponse.json({
      success: true,
      projects,
    });

  } catch (err) {
    console.error(err);

    return NextResponse.json(
      {
        success: false,
      },
      {
        status: 500,
      }
    );
  }
}