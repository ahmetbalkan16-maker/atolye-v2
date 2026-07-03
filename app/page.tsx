import Sidebar from "@/components/Sidebar";
import Dashboard from "@/components/Dashboard";
import fs from "fs";
import path from "path";

export default async function HomePage() {
  const folder = path.join(process.cwd(), "data", "projects");

  let projects: any[] = [];

  if (fs.existsSync(folder)) {
    const files = fs.readdirSync(folder);

    projects = files
      .filter((f) => f.endsWith(".json"))
      .map((file) => {
        const json = JSON.parse(
          fs.readFileSync(path.join(folder, file), "utf8")
        );

        return {
          file,
          topic: json.topic,
          summary: json.summary,
        };
      });
  }

  return (
    <main className="flex min-h-screen bg-black">
      <Sidebar />
      <Dashboard projects={projects} />
    </main>
  );
}