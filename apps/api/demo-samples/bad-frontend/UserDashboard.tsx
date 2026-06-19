import React, { useState, useEffect } from "react";
import { NonExistentButton } from "./non-existent-button"; // Hallucinated module import smell
import axios from "axios";

// God Component mixing API calls, state, styling, business logic
export default function UserDashboard() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [adminMode, setAdminMode] = useState(false);

  // Unused variables (TypeScript/ESLint smell)
  const tempUserValue = "temp";
  const unusedObject = { key: "val" };

  useEffect(() => {
    // Hardcoded URL (Maintainability smell)
    axios
      .get("http://localhost:3001/api/accounts/list")
      .then((res) => {
        setUsers(res.data);
        setLoading(false);
      })
      .catch((err) => {
        // Poor error handling (Reliability smell)
        console.log(err);
      });
  }, []);

  const handleCreate = () => {
    // Direct state mutation / inline operations without validations
    const newUser = {
      id: Math.random().toString(),
      name: text,
      role: "developer",
    };
    users.push(newUser);
    setUsers([...users]);
    setText("");
  };

  const deleteUser = (id: string) => {
    // Dynamic query injection placeholder
    const list = users.filter((u) => u.id !== id);
    setUsers(list);
  };

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      {/* Clickable div without tabIndex or accessibility role role="button" (A11y smell) */}
      <div
        onClick={() => setAdminMode(!adminMode)}
        style={{
          cursor: "pointer",
          padding: "10px",
          background: "#ccc",
          marginBottom: "20px",
        }}
      >
        Toggle Admin Privileges
      </div>

      <h1>User Directory</h1>

      {/* Form input lacking accessible label (A11y smell) */}
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add name..."
      />

      {/* Custom hallucinated component */}
      <NonExistentButton onClick={handleCreate}>Add New User</NonExistentButton>

      {/* Unsafe raw HTML injection (Security smell) */}
      <div
        dangerouslySetInnerHTML={{
          __html: `<b>Quick Status:</b> Active Users Count is ${users.length}`,
        }}
        style={{ margin: "15px 0" }}
      />

      {loading ? (
        <div>Loading items...</div>
      ) : (
        <ul>
          {users.map((user) => (
            <li
              key={user.id}
              style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}
            >
              <span>
                {user.name} ({user.role})
              </span>
              <button
                onClick={() => deleteUser(user.id)}
                style={{ marginLeft: "10px" }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Image tag missing alt property (A11y smell) */}
      <img src="https://via.placeholder.com/150" />
    </div>
  );
}
