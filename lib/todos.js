export async function listTodos() {
  const { todos = [] } = await chrome.storage.local.get('todos');
  return todos;
}

export async function addTodo(text) {
  const todos = await listTodos();
  const next = [...todos, { id: Date.now(), text, completed: false }];
  await chrome.storage.local.set({ todos: next });
  return next;
}

export async function toggleTodo(id) {
  const todos = await listTodos();
  const next = todos.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t));
  await chrome.storage.local.set({ todos: next });
  return next;
}

export async function removeTodo(id) {
  const todos = await listTodos();
  const next = todos.filter((t) => t.id !== id);
  await chrome.storage.local.set({ todos: next });
  return next;
}

