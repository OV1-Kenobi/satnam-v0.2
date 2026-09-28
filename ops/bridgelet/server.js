import express from "express";
import cors from "cors";
const app = express();
app.use(cors());
const DRY = process.env.DRY_RUN === "true";
app.get("/.well-known/lnurlp/:name", (req, res) => {
  const name = String(req.params.name).toLowerCase();
  // Dry-run LNURL-p — valid shape, but callback returns DRY_RUN bolt11
  res.json({
    tag: "payRequest",
    callback: `https://bridge.satnam.pub/.well-known/lnurlp/${name}/callback`,
    minSendable: 1000,
    maxSendable: 100000000000,
    metadata: JSON.stringify([["text/plain", `Pay ${name}@bridge.satnam.pub (DRY_RUN)`]]),
    commentAllowed: 0,
    // Phase 0 marker
    dryRun: DRY
  });
});
app.get("/.well-known/lnurlp/:name/callback", (req, res) => {
  const amount = BigInt(String(req.query.amount || "1000"));
  res.json({
    pr: `lnbc1dry_${amount}_dryrun`,
    routes: [],
    dryRun: true,
    comment: "Phase 0 pure CLINK dry-run — no settlement"
  });
});
app.get("/health", (req,res)=>res.json({ok:true,dryRun:DRY}));
app.listen(3001, ()=> console.log("bridgelet dry on :3001"));
