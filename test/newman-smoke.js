const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const newman = require("newman");

const secret = `postmon-secret-${crypto.randomUUID()}`;
const reportPath = path.join(os.tmpdir(), `postmon-smoke-${crypto.randomUUID()}.html`);
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json", "set-cookie": `session=${secret}` });
  response.end(JSON.stringify({ ok: true, secret }));
});

function finish(error) {
  try {
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
  } finally {
    server.close(() => {
      if (error) {
        console.error(error.message || error);
        process.exitCode = 1;
      }
    });
  }
}

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const collection = {
    info: {
      name: "PostMON security smoke",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    event: [
      {
        listen: "prerequest",
        script: { exec: ['pm.collectionVariables.set("runToken", "ok");'] }
      }
    ],
    item: [
      {
        name: "Local request",
        request: {
          method: "GET",
          header: [{ key: "Authorization", value: `Bearer ${secret}` }],
          url: `http://127.0.0.1:${address.port}/smoke`
        },
        event: [
          {
            listen: "test",
            script: {
              exec: [
                'pm.test("local response", function () {',
                "  pm.response.to.have.status(200);",
                '  pm.expect(pm.collectionVariables.get("runToken")).to.eql("ok");',
                "});"
              ]
            }
          }
        ]
      }
    ]
  };

  newman.run(
    {
      collection,
      reporters: ["htmlextra"],
      reporter: {
        htmlextra: {
          export: reportPath,
          showEnvironmentData: false,
          showGlobalData: false,
          skipSensitiveData: true
        }
      }
    },
    (error, summary) => {
      if (error) return finish(error);
      if (summary.run.failures.length) return finish(new Error("La smoke run Newman contiene failure."));
      if (!fs.existsSync(reportPath)) return finish(new Error("Il report htmlextra non e stato generato."));
      const report = fs.readFileSync(reportPath, "utf8");
      if (report.includes(secret)) return finish(new Error("Il report htmlextra contiene dati sensibili."));
      newman.run({ collection, reporters: [] }, (safeError, safeSummary) => {
        if (safeError) return finish(safeError);
        if (safeSummary.run.failures.length) return finish(new Error("La smoke run sicura contiene failure."));
        console.log("Newman, modalita sicura e report redatto verificati.");
        return finish();
      });
    }
  );
});
