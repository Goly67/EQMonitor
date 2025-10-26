import express from "express";
import fs from "fs/promises"; // async read
import path from "path";
import cors from "cors";

const app = express();
const PORT = 3000;
app.use(cors());

app.get("/api/faultlines", async (req, res) => {
  try {
    const filePath = path.join(process.cwd(), "faultlines.json");
    console.log("Serving faultlines from:", filePath);

    const fileData = await fs.readFile(filePath, "utf8");
    const geojson = JSON.parse(fileData);

    if (!geojson.type || !geojson.features) {
      throw new Error("Invalid GeoJSON structure");
    }

    res.json(geojson);
  } catch (err) {
    console.error("Could not serve fault lines:", err.message);
    res.status(500).json({ error: "Could not fetch fault lines" });
  }
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
