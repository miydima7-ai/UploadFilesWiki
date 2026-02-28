const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

const app = express();
const PORT = 3000;

// Создаем папку uploads если её нет
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Создаем папку для статей википедии
const wikipediaDir = path.join(__dirname, 'wikipedia_articles');
if (!fs.existsSync(wikipediaDir)) {
  fs.mkdirSync(wikipediaDir, { recursive: true });
}

// Настройка multer для сохранения файлов в папку uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Сохраняем оригинальное имя файла
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

// Разрешаем CORS для доступа извне
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Парсинг JSON для POST запросов
app.use(express.json());

// Статические файлы (HTML, CSS, JS)
app.use(express.static('public'));

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница википедии
app.get('/wikipedia', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wikipedia.html'));
});

// Загрузка файла
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не был загружен' });
  }
  res.json({ 
    message: 'Файл успешно загружен',
    filename: req.file.filename,
    size: req.file.size
  });
});

// Получение списка всех файлов
app.get('/files', (req, res) => {
  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка при чтении папки' });
    }
    const fileList = files.map(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: stats.size,
        date: stats.mtime
      };
    });
    res.json(fileList);
  });
});

// Скачивание файла
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);
  
  // Проверяем существование файла
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Файл не найден' });
  }
  
  res.download(filePath, filename, (err) => {
    if (err) {
      res.status(500).json({ error: 'Ошибка при скачивании файла' });
    }
  });
});

// Удаление файла
app.delete('/delete/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Файл не найден' });
  }
  
  fs.unlink(filePath, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка при удалении файла' });
    }
    res.json({ message: 'Файл успешно удален' });
  });
});

// Поиск в Wikipedia
app.get('/api/wikipedia/search', (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Запрос не указан' });
  }

  const urlObj = new URL(`https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=10&utf8=1`);
  
  const options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': 'FileServer/1.0 (Contact: file-server@example.com)'
    }
  };

  const wikiReq = https.request(options, (apiRes) => {
    // Проверяем статус код
    if (apiRes.statusCode !== 200) {
      return res.status(500).json({ error: `Wikipedia API вернул статус ${apiRes.statusCode}` });
    }

    let data = '';
    apiRes.setEncoding('utf8');
    apiRes.on('data', (chunk) => {
      data += chunk;
    });
    apiRes.on('end', () => {
      try {
        if (!data) {
          return res.status(500).json({ error: 'Пустой ответ от Wikipedia API' });
        }
        const result = JSON.parse(data);
        if (result.error) {
          return res.status(500).json({ error: `Ошибка Wikipedia API: ${result.error.info || 'Неизвестная ошибка'}` });
        }
        res.json(result);
      } catch (error) {
        console.error('Ошибка парсинга JSON:', error.message);
        console.error('Данные:', data.substring(0, 200));
        res.status(500).json({ error: `Ошибка при обработке ответа Wikipedia: ${error.message}` });
      }
    });
  });

  wikiReq.on('error', (error) => {
    console.error('Ошибка запроса к Wikipedia:', error.message);
    res.status(500).json({ error: `Ошибка при запросе к Wikipedia: ${error.message}` });
  });

  wikiReq.end();
});

// Получение статьи из Wikipedia (полный текст)
app.get('/api/wikipedia/article', (req, res) => {
  const title = req.query.title;
  const full = req.query.full === 'true'; // Параметр для получения полного текста
  if (!title) {
    return res.status(400).json({ error: 'Название статьи не указано' });
  }

  // Используем exintro только если не запрошен полный текст
  const extractParams = full ? 'explaintext' : 'exintro&explaintext';
  const urlObj = new URL(`https://ru.wikipedia.org/w/api.php?action=query&prop=extracts&${extractParams}&titles=${encodeURIComponent(title)}&format=json&utf8=1`);

  const options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': 'FileServer/1.0 (Contact: file-server@example.com)'
    }
  };

  const wikiReq = https.request(options, (apiRes) => {
    // Проверяем статус код
    if (apiRes.statusCode !== 200) {
      return res.status(500).json({ error: `Wikipedia API вернул статус ${apiRes.statusCode}` });
    }

    let data = '';
    apiRes.setEncoding('utf8');
    apiRes.on('data', (chunk) => {
      data += chunk;
    });
    apiRes.on('end', () => {
      try {
        if (!data) {
          return res.status(500).json({ error: 'Пустой ответ от Wikipedia API' });
        }
        const result = JSON.parse(data);
        if (result.error) {
          return res.status(500).json({ error: `Ошибка Wikipedia API: ${result.error.info || 'Неизвестная ошибка'}` });
        }
        res.json(result);
      } catch (error) {
        console.error('Ошибка парсинга JSON:', error.message);
        console.error('Данные:', data.substring(0, 200));
        res.status(500).json({ error: `Ошибка при обработке ответа Wikipedia: ${error.message}` });
      }
    });
  });

  wikiReq.on('error', (error) => {
    console.error('Ошибка запроса к Wikipedia:', error.message);
    res.status(500).json({ error: `Ошибка при запросе к Wikipedia: ${error.message}` });
  });

  wikiReq.end();
});

// Загрузка статьи по URL Wikipedia
app.post('/api/wikipedia/load-url', (req, res) => {
  const url = req.body.url;
  if (!url) {
    return res.status(400).json({ error: 'URL не указан' });
  }

  // Извлекаем название статьи из URL
  // Пример: https://ru.wikipedia.org/wiki/Название_статьи
  let title = '';
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    title = decodeURIComponent(pathParts[pathParts.length - 1].replace(/_/g, ' '));
  } catch (error) {
    return res.status(400).json({ error: 'Неверный URL' });
  }

  if (!title) {
    return res.status(400).json({ error: 'Не удалось извлечь название статьи из URL' });
  }

  // Получаем полный текст статьи
  const urlObj = new URL(`https://ru.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext&titles=${encodeURIComponent(title)}&format=json&utf8=1`);

  const options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': 'FileServer/1.0 (Contact: file-server@example.com)'
    }
  };

  const wikiReq = https.request(options, (apiRes) => {
    // Проверяем статус код
    if (apiRes.statusCode !== 200) {
      return res.status(500).json({ error: `Wikipedia API вернул статус ${apiRes.statusCode}` });
    }

    let data = '';
    apiRes.setEncoding('utf8');
    apiRes.on('data', (chunk) => {
      data += chunk;
    });
    apiRes.on('end', () => {
      try {
        if (!data) {
          return res.status(500).json({ error: 'Пустой ответ от Wikipedia API' });
        }
        const result = JSON.parse(data);
        if (result.error) {
          return res.status(500).json({ error: `Ошибка Wikipedia API: ${result.error.info || 'Неизвестная ошибка'}` });
        }
        const pages = result.query.pages;
        const pageId = Object.keys(pages)[0];
        const page = pages[pageId];
        
        if (page.missing) {
          return res.status(404).json({ error: 'Статья не найдена' });
        }

        const content = `# ${page.title}\n\n${page.extract || 'Содержимое недоступно'}\n\n---\nИсточник: ${url}\nДата: ${new Date().toLocaleString('ru-RU')}`;
        const filename = `${title.replace(/[^a-zа-яё0-9]/gi, '_')}.txt`;
        const filePath = path.join(wikipediaDir, filename);

        fs.writeFile(filePath, content, 'utf8', (err) => {
          if (err) {
            console.error('Ошибка сохранения файла:', err.message);
            return res.status(500).json({ error: `Ошибка при сохранении файла: ${err.message}` });
          }
          res.json({ 
            message: 'Статья успешно загружена',
            title: page.title,
            filename: filename,
            downloadUrl: `/wikipedia/download/${encodeURIComponent(filename)}`
          });
        });
      } catch (error) {
        console.error('Ошибка парсинга JSON:', error.message);
        console.error('Данные:', data.substring(0, 200));
        res.status(500).json({ error: `Ошибка при обработке ответа Wikipedia: ${error.message}` });
      }
    });
  });

  wikiReq.on('error', (error) => {
    console.error('Ошибка запроса к Wikipedia:', error.message);
    res.status(500).json({ error: `Ошибка при запросе к Wikipedia: ${error.message}` });
  });

  wikiReq.end();
});

// Скачивание статьи Wikipedia (полный текст)
app.get('/api/wikipedia/download', (req, res) => {
  const title = req.query.title;
  if (!title) {
    return res.status(400).json({ error: 'Название статьи не указано' });
  }

  // Получаем полный текст статьи (без exintro)
  const urlObj = new URL(`https://ru.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext&titles=${encodeURIComponent(title)}&format=json&utf8=1`);

  const options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': 'FileServer/1.0 (Contact: file-server@example.com)'
    }
  };

  const wikiReq = https.request(options, (apiRes) => {
    // Проверяем статус код
    if (apiRes.statusCode !== 200) {
      return res.status(500).json({ error: `Wikipedia API вернул статус ${apiRes.statusCode}` });
    }

    let data = '';
    apiRes.setEncoding('utf8');
    apiRes.on('data', (chunk) => {
      data += chunk;
    });
    apiRes.on('end', () => {
      try {
        if (!data) {
          return res.status(500).json({ error: 'Пустой ответ от Wikipedia API' });
        }
        const result = JSON.parse(data);
        if (result.error) {
          return res.status(500).json({ error: `Ошибка Wikipedia API: ${result.error.info || 'Неизвестная ошибка'}` });
        }
        const pages = result.query.pages;
        const pageId = Object.keys(pages)[0];
        const page = pages[pageId];
        
        if (page.missing) {
          return res.status(404).json({ error: 'Статья не найдена' });
        }

        const content = `# ${page.title}\n\n${page.extract || 'Содержимое недоступно'}\n\n---\nИсточник: https://ru.wikipedia.org/wiki/${encodeURIComponent(title)}\nДата: ${new Date().toLocaleString('ru-RU')}`;
        const filename = `${title.replace(/[^a-zа-яё0-9]/gi, '_')}.txt`;
        const filePath = path.join(wikipediaDir, filename);

        fs.writeFile(filePath, content, 'utf8', (err) => {
          if (err) {
            console.error('Ошибка сохранения файла:', err.message);
            return res.status(500).json({ error: `Ошибка при сохранении файла: ${err.message}` });
          }
          res.json({ 
            message: 'Статья успешно сохранена',
            filename: filename,
            downloadUrl: `/wikipedia/download/${encodeURIComponent(filename)}`
          });
        });
      } catch (error) {
        console.error('Ошибка парсинга JSON:', error.message);
        console.error('Данные:', data.substring(0, 200));
        res.status(500).json({ error: `Ошибка при обработке ответа Wikipedia: ${error.message}` });
      }
    });
  });

  wikiReq.on('error', (error) => {
    console.error('Ошибка запроса к Wikipedia:', error.message);
    res.status(500).json({ error: `Ошибка при запросе к Wikipedia: ${error.message}` });
  });

  wikiReq.end();
});

// Скачивание файла из папки википедии
app.get('/wikipedia/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(wikipediaDir, filename);
  
  // Проверяем существование файла
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Файл не найден' });
  }
  
  res.download(filePath, filename, (err) => {
    if (err) {
      res.status(500).json({ error: 'Ошибка при скачивании файла' });
    }
  });
});

// Получение списка статей википедии
app.get('/api/wikipedia/files', (req, res) => {
  fs.readdir(wikipediaDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Ошибка при чтении папки' });
    }
    const fileList = files.map(file => {
      const filePath = path.join(wikipediaDir, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: stats.size,
        date: stats.mtime
      };
    });
    res.json(fileList);
  });
});

// Функция для получения локального IP адреса
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Пропускаем внутренние и не-IPv4 адреса
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('='.repeat(50));
  console.log('✅ Сервер запущен и доступен извне!');
  console.log('='.repeat(50));
  console.log(`🌐 Локальный доступ: http://localhost:${PORT}`);
  console.log(`🌍 Доступ из сети:    http://${localIP}:${PORT}`);
  console.log(`📁 Файлы сохраняются в: ${uploadsDir}`);
  console.log(`📚 Статьи википедии в: ${wikipediaDir}`);
  console.log('='.repeat(50));
  console.log('\n⚠️  Убедитесь, что порт 3000 открыт в файрволе!');
});

