export function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${err.message}`);
  const status = err.status || 500;
  res.status(status).json({
    error: true,
    message: err.message || 'Внутренняя ошибка сервера',
    status,
  });
}

export function validateIndexRequest(req, res, next) {
  const { path: docPath, strategy } = req.body;
  if (!docPath) {
    return res.status(400).json({ error: true, message: 'Поле "path" обязательно' });
  }
  if (strategy && !['fixed', 'semantic'].includes(strategy)) {
    return res.status(400).json({ error: true, message: 'Стратегия должна быть "fixed" или "semantic"' });
  }
  next();
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: true, message: `Маршрут ${req.method} ${req.url} не найден` });
}
