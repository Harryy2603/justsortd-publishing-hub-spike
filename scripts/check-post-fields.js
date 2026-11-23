// Lists the fields Buffer lets us read on a Post (to find a post URL field).
// Run: $env:BUFFER_KEY="your_key"; node check-post-fields.js
const key = process.env.BUFFER_KEY;
(async () => {
  const r = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: `{ __type(name: "Post") { fields { name } } }` }),
  });
  const j = await r.json();
  console.log(j.data && j.data.__type ? j.data.__type.fields.map(f => f.name).join(", ") : JSON.stringify(j));
})();
