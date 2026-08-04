const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const port = Number(process.argv[2] || process.env.PORT || 4173);

http.createServer((request, response) => {
  const pathname = decodeURIComponent(request.url.split("?")[0]);
  const target = path.join(root, pathname === "/" ? "index.html" : pathname);
  if (!target.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream" });
    response.end(data);
  });
}).listen(port, "127.0.0.1", () => console.log(`BasePaint Live on http://127.0.0.1:${port}`));
