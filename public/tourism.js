'use strict';

// Pontos de interesse das cidades por onde os compradores costumam passar (Feira de Cantão e
// polos de fornecedores). Ficam no próprio app: funcionam sem internet e sem serviços do Google,
// que são bloqueados na China. As coordenadas (aproximadas) servem só para ordenar por distância;
// a navegação abre o mapa buscando pelo nome em chinês.
// cat: turismo | cultura | compras | gastronomia | natureza
(function (root) {
  const CITIES = [
    { id: 'guangzhou', name: 'Guangzhou', zh: '广州', lat: 23.129, lng: 113.264 },
    { id: 'shenzhen', name: 'Shenzhen', zh: '深圳', lat: 22.543, lng: 114.058 },
    { id: 'foshan', name: 'Foshan', zh: '佛山', lat: 23.022, lng: 113.122 },
    { id: 'hongkong', name: 'Hong Kong', zh: '香港', lat: 22.302, lng: 114.177 },
    { id: 'macau', name: 'Macau', zh: '澳门', lat: 22.190, lng: 113.543 },
    { id: 'yiwu', name: 'Yiwu', zh: '义乌', lat: 29.306, lng: 120.075 },
    { id: 'hangzhou', name: 'Hangzhou', zh: '杭州', lat: 30.274, lng: 120.155 },
    { id: 'shanghai', name: 'Xangai', zh: '上海', lat: 31.230, lng: 121.474 },
    { id: 'beijing', name: 'Pequim', zh: '北京', lat: 39.904, lng: 116.407 },
    { id: 'wuhan', name: 'Wuhan', zh: '武汉', lat: 30.593, lng: 114.305 },
    { id: 'jinan', name: 'Jinan', zh: '济南', lat: 36.651, lng: 117.120 },
  ];

  const P = (city, cat, name, zh, lat, lng, desc) => ({ city, cat, name, zh, lat, lng, desc });
  const PLACES = [
    // Guangzhou
    P('guangzhou', 'turismo', 'Canton Tower', '广州塔', 23.1066, 113.3245, 'Torre de 600 m com mirante e roda-gigante no topo. À noite a vista do rio Pérola é a melhor.'),
    P('guangzhou', 'turismo', 'Praça Huacheng', '花城广场', 23.1196, 113.3257, 'Centro moderno de Zhujiang New Town, entre arranha-céus iluminados. Bom passeio à noite.'),
    P('guangzhou', 'turismo', 'Cruzeiro noturno no Rio Pérola', '珠江夜游 天字码头', 23.1188, 113.2705, 'Passeio de barco de cerca de 1 hora vendo a cidade iluminada. Embarque no píer Tianzi.'),
    P('guangzhou', 'cultura', 'Ilha Shamian', '沙面岛', 23.1076, 113.2425, 'Antigo bairro das concessões europeias, com prédios coloniais, árvores e cafés. Tranquilo para caminhar.'),
    P('guangzhou', 'cultura', 'Templo do Clã Chen', '陈家祠', 23.1257, 113.2448, 'Academia ancestral do século XIX com entalhes em madeira, pedra e cerâmica impressionantes.'),
    P('guangzhou', 'cultura', 'Catedral do Sagrado Coração', '石室圣心大教堂', 23.1173, 113.2667, 'Catedral gótica toda em granito, uma das maiores do gênero na Ásia.'),
    P('guangzhou', 'cultura', 'Museu de Guangdong', '广东省博物馆', 23.1146, 113.3260, 'Museu provincial com arte, história e natureza do sul da China. Entrada gratuita com reserva (leve o passaporte).'),
    P('guangzhou', 'natureza', 'Parque Yuexiu', '越秀公园', 23.1395, 113.2647, 'Maior parque do centro, com a estátua das Cinco Cabras, símbolo da cidade, e a Torre Zhenhai.'),
    P('guangzhou', 'natureza', 'Montanha Baiyun', '白云山', 23.1786, 113.2985, 'Montanha com trilhas e teleférico, vista panorâmica da cidade. Reserve meio dia.'),
    P('guangzhou', 'compras', 'Rua Beijing Lu', '北京路步行街', 23.1247, 113.2696, 'Rua de pedestres com lojas e comida de rua; no chão, vidros mostram ruínas de estradas antigas.'),
    P('guangzhou', 'compras', 'Shangxiajiu', '上下九步行街', 23.1170, 113.2468, 'Rua comercial tradicional com arcadas no estilo cantonês, lojas populares e lanches.'),
    P('guangzhou', 'gastronomia', 'Guangzhou Restaurant', '广州酒家 文昌总店', 23.1193, 113.2486, 'Restaurante histórico de culinária cantonesa e dim sum. Vá cedo para evitar fila.'),
    P('guangzhou', 'gastronomia', 'Tao Tao Ju', '陶陶居', 23.1195, 113.2510, 'Casa de chá centenária, famosa pelo dim sum. Ótima para um café da manhã cantonês.'),

    // Shenzhen
    P('shenzhen', 'compras', 'Huaqiangbei', '华强北', 22.5450, 114.0855, 'Maior polo de eletrônicos do mundo: componentes, celulares, acessórios e novidades.'),
    P('shenzhen', 'compras', 'Vila de pintura Dafen', '大芬油画村', 22.6142, 114.1385, 'Centenas de ateliês que produzem e vendem quadros a óleo, inclusive sob encomenda.'),
    P('shenzhen', 'turismo', 'Window of the World', '世界之窗', 22.5378, 113.9732, 'Parque com réplicas de monumentos do mundo inteiro, incluindo uma Torre Eiffel.'),
    P('shenzhen', 'cultura', 'Splendid China', '锦绣中华民俗村', 22.5338, 113.9870, 'Miniaturas das grandes atrações da China e vila de cultura das etnias chinesas.'),
    P('shenzhen', 'turismo', 'Ping An Finance Centre', '平安金融中心 云际观光层', 22.5333, 114.0553, 'Um dos prédios mais altos do mundo, com mirante a mais de 500 m.'),
    P('shenzhen', 'cultura', 'OCT Loft', '华侨城创意文化园', 22.5413, 113.9917, 'Antigas fábricas transformadas em galerias, cafés e lojas de design.'),
    P('shenzhen', 'gastronomia', 'Sea World Shekou', '蛇口海上世界', 22.4836, 113.9135, 'Área à beira-mar com restaurantes internacionais, bares e um navio histórico.'),
    P('shenzhen', 'natureza', 'Parque Lianhuashan', '莲花山公园', 22.5544, 114.0560, 'Parque com vista do centro financeiro do alto da colina. Bom no fim da tarde.'),

    // Foshan
    P('foshan', 'cultura', 'Templo Ancestral (Zumiao)', '佛山祖庙', 23.0337, 113.1124, 'Templo taoísta do século XI com apresentações de kung fu e dança do leão.'),
    P('foshan', 'compras', 'Lingnan Tiandi', '岭南天地', 23.0322, 113.1152, 'Quarteirão histórico restaurado com lojas, cafés e restaurantes, ao lado do Zumiao.'),
    P('foshan', 'cultura', 'Forno antigo Nanfeng', '南风古灶', 23.0040, 113.0820, 'Fornos de cerâmica em uso há 500 anos no bairro de Shiwan, berço da cerâmica de Foshan.'),
    P('foshan', 'cultura', 'Jardim Qinghui', '清晖园', 22.8436, 113.2549, 'Um dos quatro grandes jardins clássicos de Guangdong, em Shunde.'),
    P('foshan', 'compras', 'Lecong – polo de móveis', '乐从家具城', 22.9680, 113.0960, 'Quilômetros de lojas de móveis de fábrica, referência para compradores do setor.'),
    P('foshan', 'gastronomia', 'Culinária de Shunde', '顺德美食 大良', 22.8400, 113.2500, 'Shunde é Cidade da Gastronomia da UNESCO: prove o pudim de leite duplo (双皮奶).'),

    // Hong Kong
    P('hongkong', 'turismo', 'Victoria Peak', '太平山顶', 22.2759, 114.1455, 'A vista clássica de Hong Kong. Suba pelo bondinho Peak Tram.'),
    P('hongkong', 'turismo', 'Avenida das Estrelas', '星光大道', 22.2931, 114.1745, 'Calçadão de Tsim Sha Tsui com vista da ilha. Às 20h tem o show de luzes Symphony of Lights.'),
    P('hongkong', 'turismo', 'Star Ferry', '天星小轮', 22.2939, 114.1683, 'Travessia de balsa centenária entre Kowloon e a ilha, barata e com ótima vista.'),
    P('hongkong', 'cultura', 'Grande Buda Tian Tan', '天坛大佛', 22.2540, 113.9050, 'Buda de bronze gigante na ilha de Lantau, com teleférico Ngong Ping 360.'),
    P('hongkong', 'compras', 'Temple Street', '庙街夜市', 22.3058, 114.1700, 'Feira noturna com barracas de souvenirs, eletrônicos e comida de rua.'),
    P('hongkong', 'compras', 'Ladies\' Market', '女人街', 22.3190, 114.1710, 'Mercado de rua em Mong Kok com roupas, acessórios e lembranças. Pechinche.'),
    P('hongkong', 'compras', 'Sham Shui Po', '深水埗', 22.3307, 114.1622, 'Bairro de eletrônicos, tecidos e aviamentos, com comida local barata.'),

    // Macau
    P('macau', 'cultura', 'Ruínas de São Paulo', '大三巴牌坊', 22.1975, 113.5409, 'Fachada da igreja jesuíta do século XVII, cartão-postal de Macau.'),
    P('macau', 'cultura', 'Largo do Senado', '议事亭前地', 22.1934, 113.5398, 'Praça com calçada portuguesa e prédios coloniais. Ponto de partida do centro histórico.'),
    P('macau', 'cultura', 'Templo de A-Má', '妈阁庙', 22.1863, 113.5310, 'Templo mais antigo de Macau, que deu nome à cidade.'),
    P('macau', 'turismo', 'Torre de Macau', '澳门旅游塔', 22.1797, 113.5370, 'Torre de 338 m com mirante e o famoso bungee jump.'),
    P('macau', 'gastronomia', 'Vila da Taipa', '氹仔旧城区', 22.1535, 113.5568, 'Ruelas com casas portuguesas e a Rua do Cunha, cheia de restaurantes macaenses.'),
    P('macau', 'turismo', 'The Venetian', '澳门威尼斯人', 22.1477, 113.5600, 'Resort-cassino com canais e gôndolas no Cotai Strip.'),

    // Yiwu
    P('yiwu', 'compras', 'International Trade City', '义乌国际商贸城', 29.3338, 120.1083, 'O maior mercado atacadista do mundo, com dezenas de milhares de lojas divididas em distritos.'),
    P('yiwu', 'compras', 'Mercado Huangyuan', '篁园服装市场', 29.3150, 120.0880, 'Mercado atacadista de roupas e acessórios de moda.'),
    P('yiwu', 'gastronomia', 'Feira noturna Binwang', '宾王夜市', 29.3088, 120.0780, 'Feira noturna com comida de rua e barracas de produtos variados.'),
    P('yiwu', 'gastronomia', 'Rua dos restaurantes árabes', '义乌异国风情街', 29.3120, 120.0900, 'Rua com restaurantes do Oriente Médio e de várias partes do mundo, frequentada por compradores.'),

    // Hangzhou
    P('hangzhou', 'natureza', 'Lago Oeste', '西湖', 30.2590, 120.1520, 'Lago mais famoso da China, com pontes, jardins e pagodes. Comece pela Ponte Quebrada (断桥).'),
    P('hangzhou', 'cultura', 'Templo Lingyin', '灵隐寺', 30.2420, 120.1010, 'Templo budista milenar com esculturas em pedra na encosta.'),
    P('hangzhou', 'compras', 'Rua Hefang', '河坊街', 30.2420, 120.1700, 'Rua histórica com lojas tradicionais, farmácias antigas e lanches.'),
    P('hangzhou', 'natureza', 'Vila de chá Longjing', '龙井村', 30.2290, 120.1290, 'Plantações do famoso chá verde Longjing, com degustação nas casas de chá.'),

    // Xangai
    P('shanghai', 'turismo', 'The Bund', '外滩', 31.2400, 121.4900, 'Calçadão com prédios históricos de frente para os arranha-céus de Pudong. Imperdível à noite.'),
    P('shanghai', 'turismo', 'Torre Pérola Oriental', '东方明珠', 31.2397, 121.4998, 'Torre símbolo de Xangai, com mirante e piso de vidro.'),
    P('shanghai', 'turismo', 'Shanghai Tower', '上海中心大厦', 31.2335, 121.5055, 'Um dos prédios mais altos do mundo, com mirante no 118º andar.'),
    P('shanghai', 'cultura', 'Jardim Yu', '豫园', 31.2272, 121.4921, 'Jardim clássico da dinastia Ming, cercado por um bazar de lojas e lanches.'),
    P('shanghai', 'compras', 'Rua Nanjing', '南京路步行街', 31.2360, 121.4780, 'Principal rua comercial da cidade, com lojas de departamento e luzes à noite.'),
    P('shanghai', 'compras', 'Tianzifang', '田子坊', 31.2100, 121.4690, 'Labirinto de vielas antigas com lojinhas, ateliês e cafés.'),
    P('shanghai', 'gastronomia', 'Xintiandi', '新天地', 31.2190, 121.4750, 'Casas tradicionais shikumen convertidas em restaurantes e bares.'),
    P('shanghai', 'cultura', 'Vila aquática Zhujiajiao', '朱家角古镇', 31.1100, 121.0560, 'Vila antiga com canais e pontes de pedra, a cerca de 1 hora do centro.'),

    // Pequim
    P('beijing', 'cultura', 'Cidade Proibida', '故宫', 39.9163, 116.3972, 'Palácio imperial das dinastias Ming e Qing. Compre o ingresso online com antecedência (passaporte).'),
    P('beijing', 'turismo', 'Praça da Paz Celestial', '天安门广场', 39.9055, 116.3976, 'A maior praça pública do mundo, em frente à Cidade Proibida. Leve o passaporte.'),
    P('beijing', 'cultura', 'Templo do Céu', '天坛', 39.8822, 116.4066, 'Complexo onde os imperadores rezavam pelas colheitas, cercado por um parque.'),
    P('beijing', 'cultura', 'Palácio de Verão', '颐和园', 39.9999, 116.2755, 'Jardins imperiais à beira de um lago, com galerias e pavilhões. Reserve meio dia.'),
    P('beijing', 'natureza', 'Grande Muralha – Mutianyu', '慕田峪长城', 40.4319, 116.5704, 'Trecho restaurado e menos cheio da Muralha, com teleférico e tobogã. Cerca de 1h30 do centro.'),
    P('beijing', 'cultura', 'Hutongs de Nanluoguxiang', '南锣鼓巷', 39.9370, 116.4033, 'Vielas tradicionais de Pequim com lojas, bares e casas com pátio.'),
    P('beijing', 'cultura', 'Distrito de arte 798', '798艺术区', 39.9840, 116.4950, 'Antigas fábricas convertidas em galerias de arte contemporânea.'),
    P('beijing', 'compras', 'Silk Market', '秀水街', 39.9087, 116.4440, 'Mercado de roupas, seda e souvenirs. Pechinche bastante.'),
    P('beijing', 'gastronomia', 'Pato laqueado', '北京烤鸭 全聚德 前门店', 39.8970, 116.3980, 'Prove o pato de Pequim no tradicional Quanjude, perto de Qianmen.'),

    // Wuhan
    P('wuhan', 'turismo', 'Torre do Grou Amarelo', '黄鹤楼', 30.5446, 114.3025, 'Torre símbolo de Wuhan, cantada em poemas clássicos, com vista do rio Yangtzé.'),
    P('wuhan', 'turismo', 'Ponte do Rio Yangtzé', '武汉长江大桥', 30.5500, 114.2880, 'Primeira ponte sobre o Yangtzé (1957). Dá para atravessar a pé e ver o rio.'),
    P('wuhan', 'turismo', 'Orla de Hankou', '汉口江滩', 30.5900, 114.3000, 'Calçadão à beira do Yangtzé com prédios históricos da antiga concessão. Bonito à noite.'),
    P('wuhan', 'cultura', 'Museu Provincial de Hubei', '湖北省博物馆', 30.5610, 114.3650, 'Guarda os sinos de bronze do Marquês Yi, com mais de 2.400 anos. Entrada gratuita com passaporte.'),
    P('wuhan', 'cultura', 'Templo Guiyuan', '归元寺', 30.5480, 114.2620, 'Templo budista com um salão de 500 estátuas de arhats.'),
    P('wuhan', 'natureza', 'Lago Leste', '东湖', 30.5530, 114.4020, 'Grande lago urbano com trilhas, ciclovia e a área de Moshan. Ótimo para caminhar.'),
    P('wuhan', 'gastronomia', 'Beco Hubu', '户部巷', 30.5490, 114.2990, 'Rua de comida de rua e café da manhã. Prove o macarrão seco quente (热干面), prato típico.'),
    P('wuhan', 'compras', 'Rua Jianghan', '江汉路步行街', 30.5800, 114.2880, 'Principal rua comercial, com prédios do início do século XX.'),
    P('wuhan', 'compras', 'Chu River & Han Street', '楚河汉街', 30.5620, 114.3410, 'Rua de compras e restaurantes à beira de um canal, com lojas modernas.'),
    P('wuhan', 'compras', 'Hanzhengjie – atacado', '汉正街', 30.5720, 114.2700, 'Tradicional polo atacadista de Wuhan: roupas, calçados, utilidades e pequenas mercadorias.'),

    // Jinan
    P('jinan', 'natureza', 'Fonte Baotu', '趵突泉', 36.6610, 117.0160, 'A mais famosa das 72 fontes de Jinan, a "cidade das fontes". Parque no centro.'),
    P('jinan', 'natureza', 'Lago Daming', '大明湖', 36.6750, 117.0240, 'Lago no centro histórico, com pavilhões, barcos e passeio à beira d\'água.'),
    P('jinan', 'natureza', 'Fonte do Tigre Negro', '黑虎泉', 36.6600, 117.0280, 'Fonte junto ao fosso da antiga muralha; moradores enchem garrafas com a água.'),
    P('jinan', 'natureza', 'Parque Wulongtan', '五龙潭', 36.6660, 117.0120, 'Parque tranquilo com várias fontes de água cristalina.'),
    P('jinan', 'cultura', 'Montanha dos Mil Budas', '千佛山', 36.6390, 117.0300, 'Colina com templos e budas esculpidos na rocha, e vista da cidade.'),
    P('jinan', 'cultura', 'Museu de Shandong', '山东博物馆', 36.6610, 117.0960, 'Grande museu provincial com peças da cultura de Confúcio e de Shandong.'),
    P('jinan', 'gastronomia', 'Rua Furong', '芙蓉街', 36.6680, 117.0210, 'Viela antiga cheia de comida de rua, perto do Lago Daming.'),
    P('jinan', 'compras', 'Kuanhouli', '宽厚里', 36.6630, 117.0200, 'Rua de pedestres com lojas, bares e lanches no estilo antigo, ao lado da Fonte Baotu.'),
    P('jinan', 'natureza', 'Monte Tai', '泰山', 36.2560, 117.1010, 'Montanha sagrada da China, em Tai\'an, a cerca de 20 min de trem-bala. Subida com teleférico.'),
  ];

  const TOURISM = { CITIES, PLACES };
  if (typeof module !== 'undefined' && module.exports) module.exports = TOURISM;
  else root.TOURISM = TOURISM;
})(typeof self !== 'undefined' ? self : this);
