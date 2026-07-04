import { config } from '../config.js';
import { db } from '../storage/db.js';

const RU_TO_EN = {
  'реакций':'reaction','реакции':'reaction','реакция':'reaction',
  'истории':'history','история':'history',
  'модальное':'modal','модальный':'modal','модального':'modal','модальном':'modal',
  'окно':'dialog','окна':'dialog','окне':'dialog',
  'компонент':'component','компонента':'component','компоненте':'component','компоненты':'component','компонентов':'component',
  'список':'list','списка':'list',
  'сообщений':'message','сообщения':'message','сообщение':'message',
  'чат':'chat','чата':'chat','чате':'chat',
  'пользователь':'user','пользователя':'user',
  'настройки':'settings','настройка':'settings',
  'профиль':'profile','профиля':'profile',
  'поиск':'search','поиска':'search',
  'файл':'file','файла':'file',
  'меню':'menu',
  'кнопка':'button','кнопки':'button',
  'функция':'function','функции':'function',
  'класс':'class','класса':'class',
  'сервис':'service','сервиса':'service',
  'менеджер':'manager',
  'модуль':'module','модуля':'module',
  'уведомление':'notification','уведомления':'notification',
  'шаблон':'template','шаблона':'template',
  'страница':'page','страницы':'page',
  'форма':'form','формы':'form',
  'таблица':'table','таблицы':'table',
  'событие':'event','события':'event','событий':'event',
  'обработчик':'handler','обработчики':'handler','обработчика':'handler','обработчиков':'handler',
  'навешивание':'attach','навешивания':'attach','навешивать':'attach','навешиваются':'attach',
  'подписка':'subscribe','подписки':'subscribe','подписку':'subscribe',
  'подписчик':'listener','подписчики':'listener',
  'колбэк':'callback','колбэка':'callback','колбэке':'callback',
  'асинхронный':'async','асинхронная':'async','асинхронного':'async',
  'запрос':'request','запроса':'request','запросы':'request',
  'ответ':'response','ответа':'response',
  'роут':'route','роута':'route','роуты':'route',
  'контроллер':'controller','контроллера':'controller',
  'переменная':'variable','переменные':'variable','переменной':'variable',
  'значение':'value','значения':'value',
  'свойство':'property','свойства':'property',
  'метод':'method','метода':'method','методы':'method',
  'аргумент':'argument','аргумента':'argument','аргументы':'argument',
  'параметр':'parameter','параметра':'parameter','параметры':'parameter',
  'создать':'create','создания':'create','создание':'create','создавать':'create','создаётся':'create',
  'новый':'new','новая':'new','новое':'new','новые':'new','нового':'new','новой':'new',
  'веб':'web',
  'получить':'get','получение':'get','получения':'get','получаем':'get',
  'установить':'set','установка':'set','устанавливается':'set',
  'удалить':'delete','удаление':'delete','удаляется':'delete',
  'добавить':'add','добавление':'add','добавляется':'add',
  'изменить':'change','изменение':'change',
  'сохранить':'save','сохраняется':'save',
  'загрузить':'load','загрузка':'load','загрузки':'load',
  'показать':'show','отобразить':'display','отображается':'display',
  'вызвать':'call','вызывается':'call','вызов':'call',
  'обработать':'process','обрабатывается':'process',
  'проверить':'check','проверка':'check',
  'использовать':'use','используется':'use','используются':'use',
  'работает':'work','работают':'work',
  'содержит':'contain','содержащий':'contain',
  'называется':'called','называют':'called',
  'должен':'must','должна':'must','должны':'must',
  'нужно':'need','необходимо':'need',
  'может':'can','могут':'can','можно':'can',
  'помощь':'help','помощи':'help',
  'пример':'example','примера':'example',
};

const RU_TO_LATIN = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z',
  'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
  'с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
  'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
};

function transliterate(word) {
  let result = '';
  for (const ch of word.toLowerCase()) {
    result += RU_TO_LATIN[ch] || ch;
  }
  return result;
}

const CONTENT_KW_STOP = new Set([
  'the','and','are','was','were','been','being',
  'have','has','had','will','would','could','should','shall',
  'can','may','might','its','your','their','our','his','her',
  'where','when','why','how','what','which','who','whom',
  'that','these','those','for','with','without','from','into',
  'onto','upon','about','within','through','during','before',
  'after','above','below','only','just','also','very','too',
  'some','any','every','each','both','few','many','much',
  'more','most','other','another','same','different','such',
  'than','then','well','back','still','already','off','over',
  'under','out','down','up','because','since','while','if',
  'between','against','include','make','work','need','want',
  'know','tell','show','case','way','example',
]);

function extractKeywords(query) {
  const words = query.toLowerCase().split(/[^a-zа-яё0-9]+/).filter(w => w.length > 2);
  const stopWords = new Set([
    'какой', 'какая', 'какое', 'какие', 'этот', 'эта', 'это', 'эти',
    'который', 'которая', 'которое', 'которые', 'свой', 'своя', 'своё', 'свои',
    'как', 'так', 'что', 'чем', 'для', 'наши', 'наша', 'наше', 'наши',
    'the', 'this', 'that', 'these', 'those', 'which', 'what', 'who', 'whom',
    'for', 'with', 'without', 'from', 'into', 'onto', 'upon', 'about',
    'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
    'will', 'would', 'could', 'should', 'shall', 'can', 'may', 'might',
    'its', 'your', 'their', 'our', 'his', 'her', 'all', 'each', 'every',
  ]);
  const keywords = [];
  const seen = new Set();
  for (const word of words) {
    if (stopWords.has(word)) continue;
    const latin = transliterate(word);
    const en = RU_TO_EN[word] || (word === latin ? word : '');
    if (seen.has(latin)) continue;
    seen.add(latin);
    keywords.push({ original: word, latin, english: en });
  }
  return keywords;
}

function filenameRelevance(keywords, filepath) {
  const lower = filepath.toLowerCase().replace(/\\/g, '/');
  const pathTokens = lower.split(/[/._\-]+/).filter(t => t.length > 1);
  let score = 0;
  let matched = 0;
  for (const kw of keywords) {
    let found = false;
    if (lower.includes(kw.original)) { found = true; }
    else if (lower.includes(kw.latin)) { found = true; }
    else if (kw.english && lower.includes(kw.english)) { found = true; }
    else {
      for (const token of pathTokens) {
        if (token.includes(kw.latin) || kw.latin.includes(token)) { found = true; break; }
        if (kw.english && (token.includes(kw.english) || kw.english.includes(token))) { found = true; break; }
      }
    }
    if (found) { score += 1.0; matched++; }
  }
  const coverage = keywords.length > 0 ? matched / keywords.length : 0;
  return { score, matched, coverage };
}

export class Retriever {
  constructor(embedder) {
    this.embedder = embedder;
    this._cache = null;
  }

  invalidateCache() {
    this._cache = null;
  }

  async search(question, options = {}) {
    const topK = options.topK || config.rag.topK;
    const threshold = options.threshold != null ? options.threshold : config.rag.similarityThreshold;

    const queries = [question, ...(options.additionalQueries || [])];
    const chunks = await this._getAllCached();

    const seen = new Set();
    const allScored = [];

    for (const q of queries) {
      const queryEmbedding = await this.embedder.generateEmbedding(q);
      const keywords = extractKeywords(q);

      const totalChunks = chunks.length;
      for (const kw of keywords) {
        if (!kw.english || CONTENT_KW_STOP.has(kw.english)) continue;
        let df = 0;
        for (const ch of chunks) {
          if (ch.content.toLowerCase().includes(kw.english)) df++;
        }
        kw.idfWeight = Math.max(0, Math.log(totalChunks / (df + 1)) / Math.log(1 + totalChunks));
      }

      for (const chunk of chunks) {
        if (!chunk.embedding) continue;
        const key = chunk.chunk_id;
        if (seen.has(key)) continue;

        const sim = this.cosineSimilarity(queryEmbedding, chunk.embedding);
        const meta = typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata) : chunk.metadata;
        const filename = meta?.filename || chunk.filename || '';
        const fnameRel = chunk.document_path
          ? filenameRelevance(keywords, chunk.document_path)
          : filenameRelevance(keywords, filename);
        const rawKwMatches = keywords.filter(kw =>
          kw.english && !CONTENT_KW_STOP.has(kw.english) && chunk.content.toLowerCase().includes(kw.english)
        );
        const kwInContent = rawKwMatches.length;
        const passesVector = sim >= threshold;
        const passesKeyword = keywords.length > 0 && fnameRel.coverage >= 0.3;
        const passesContent = kwInContent >= 1;

        if (passesVector || passesKeyword || passesContent) {
          seen.add(key);
          const contentKwWeighted = rawKwMatches.reduce((sum, kw) => sum + (kw.idfWeight || 1), 0);
          allScored.push({
            chunk_id: chunk.chunk_id,
            content: chunk.content,
            filename,
            extension: chunk.extension || '',
            similarity: sim,
            document_id: chunk.document_id,
            metadata: meta,
            _keywordScore: fnameRel,
            _contentKwMatches: contentKwWeighted,
          });
        }
      }
    }

    allScored.sort((a, b) => {
      const aSim = a.similarity;
      const bSim = b.similarity;
      const aKw = a._keywordScore.matched;
      const bKw = b._keywordScore.matched;
      const aCkw = a._contentKwMatches || 0;
      const bCkw = b._contentKwMatches || 0;
      const aBoost = Math.min(0.5, 0.15 * aKw + 0.2 * aCkw);
      const bBoost = Math.min(0.5, 0.15 * bKw + 0.2 * bCkw);
      return (bSim + bBoost) - (aSim + aBoost);
    });

    const topKChunks = allScored.slice(0, topK);
    const ckLimit = Math.max(50, topK);
    const contentMatchChunks = allScored.filter(c =>
      (c._contentKwMatches || 0) > 0 && !topKChunks.some(t => t.chunk_id === c.chunk_id)
    ).slice(0, ckLimit);
    return [...topKChunks, ...contentMatchChunks];
  }

  async _getAllCached() {
    if (this._cache) return this._cache;
    const chunks = db.getAllChunksWithEmbeddings();
    for (const chunk of chunks) {
      if (Array.isArray(chunk.embedding)) {
        chunk.embedding = new Float32Array(chunk.embedding);
      }
    }
    this._cache = chunks;
    return this._cache;
  }

  cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}
