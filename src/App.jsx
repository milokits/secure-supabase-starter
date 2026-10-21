import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";

export default function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <main className="wrap">
      <h1>Secure Supabase Starter</h1>
      <p className="muted">Every table has Row Level Security. You only ever see your own notes.</p>
      {session ? <Notes user={session.user} /> : <SignIn />}
    </main>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function submit(mode) {
    setMessage("");
    const fn = mode === "up" ? supabase.auth.signUp : supabase.auth.signInWithPassword;
    const { error } = await fn.call(supabase.auth, { email, password });
    setMessage(error ? error.message : mode === "up" ? "Check your inbox to confirm your email." : "");
  }

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); submit("in"); }}>
      <label>Email <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
      <label>Password <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      <div className="row">
        <button type="submit">Sign in</button>
        <button type="button" className="ghost" onClick={() => submit("up")}>Create account</button>
      </div>
      {message && <p className="muted">{message}</p>}
    </form>
  );
}

function Notes({ user }) {
  const [notes, setNotes] = useState([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  async function load() {
    // No user filter needed: RLS only returns this user's rows. Filtering anyway keeps intent clear.
    const { data, error } = await supabase.from("notes").select("id, title, created_at").eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) setError(error.message); else setNotes(data);
  }
  useEffect(() => { load(); }, [user.id]);

  async function add(e) {
    e.preventDefault();
    if (!title.trim()) return;
    // user_id defaults to auth.uid() in the database, so the client can't pick someone else's id.
    const { error } = await supabase.from("notes").insert({ title: title.trim() });
    if (error) setError(error.message); else { setTitle(""); load(); }
  }
  async function remove(id) {
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (error) setError(error.message); else load();
  }

  return (
    <section className="card">
      <div className="row between">
        <span className="muted">Signed in as {user.email}</span>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
      <form className="row" onSubmit={add}>
        <input placeholder="New note" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <button type="submit">Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      <ul>
        {notes.map((n) => (
          <li key={n.id} className="row between">
            <span>{n.title}</span>
            <button className="ghost" onClick={() => remove(n.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
