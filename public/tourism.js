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

  // Fotos (Wikimedia Commons, licenças livres): nome em chinês -> [arquivo em /tourism/, autor, licença, arquivo no Commons].
  // Miniaturas de 480×270 em WebP (~25 KB), servidas como arquivos estáticos — não ficam no banco.
  const PHOTOS = {
    "广州塔": ["Q168400", "jiang-wen-jie", "CC BY-SA 3.0", "广州塔Scenery_in_Guangzhou,_China_-_panoramio_(9).jpg"],
    "珠江夜游 天字码头": ["Q201463", "", "CC BY-SA 3.0", "Pearl_river,_Guangzhou.JPG"],
    "沙面岛": ["Q529977", "", "CC BY-SA 3.0", "ShamianIsland.JPG"],
    "陈家祠": ["Q5090739", "Shujianyang", "CC BY-SA 4.0", "Chen_Clan_Ancestral_Hall_2025.06_03.jpg"],
    "石室圣心大教堂": ["Q1195445", "Shujianyang", "CC BY-SA 4.0", "Sacred_Heart_Cathedral_of_Guangzhou_2025.06_01.jpg"],
    "广东省博物馆": ["Q5613636", "Shujianyang", "CC0", "Guangdong_Museum.jpg"],
    "越秀公园": ["Q7209907", "Df112001", "CC BY-SA 3.0", "Yxp.JPG"],
    "白云山": ["Q837385", "User:Popolon", "CC BY-SA 3.0", "Guangzhou_BaiyunShan.jpg"],
    "上下九步行街": ["Q7488612", "Ricky Chow", "CC BY-SA 3.0", "Liwanplaza.jpg"],
    "广州酒家 文昌总店": ["Q11062214", "w:zh:User:Dzb0715", "CC BY-SA 2.5", "GZ_jiujia.jpg"],
    "陶陶居": ["Q9012420", "Gzdavidwong", "CC BY-SA 3.0", "TaoTaoJu.JPG"],
    "华强北": ["Q983005", "Charlie fong", "CC BY-SA 4.0", "Huaqiangbei&Shennan_Cross2021.jpg"],
    "大芬油画村": ["Q1019090", "Renek78", "CC0", "2025_in_Dafen_Oil_Painting_Village_03.jpg"],
    "世界之窗": ["Q2302764", "", "CC BY-SA 2.5", "Window_of_the_World_SZ.JPG"],
    "平安金融中心 云际观光层": ["Q1077308", "Charlie fong", "CC BY-SA 4.0", "Pingan_International_Finance_Center2020.jpg"],
    "蛇口海上世界": ["Q10389768", "Charlie fong", "CC BY-SA 4.0", "Sea_World_in_Shekou_Shenzhen2021.jpg"],
    "莲花山公园": ["Q15941172", "jo.sau", "CC BY 2.0", "Lianhuashan_Garden.jpg"],
    "佛山祖庙": ["Q3081382", "Zhangzhugang", "CC BY-SA 3.0", "Foshan_Zu_Miao_2012.11.20_15-41-28.jpg"],
    "南风古灶": ["Q2279585", "xiquinhosilva", "CC BY-SA 2.0", "Ancient_Nanfeng_Kiln.jpg"],
    "清晖园": ["Q13649239", "User:Zhaofeng Li", "CC BY-SA 1.0", "Qing_Hui_Yuan.jpeg"],
    "太平山顶": ["Q17541", "Daniel Case", "CC BY-SA 3.0", "High_West_and_Victoria_Peak_from_Victoria_Gap_(crop1).jpg"],
    "天坛大佛": ["Q528079", "Béria Lima de Rodríguez", "CC BY-SA 3.0", "Tian_Tan_Buddha_by_Beria.jpg"],
    "庙街夜市": ["Q7698673", "hkgalbert", "CC0", "GateOfTempleInHongKong.jpg"],
    "女人街": ["Q4115280", "KamTANGO", "CC BY-SA 3.0", "HK_Prince_Edward_Tung_Choi_Street_240.JPG"],
    "深水埗": ["Q1185317", "WiNG", "CC BY-SA 3.0", "HK_Sham_Shui_Po_2009.jpg"],
    "大三巴牌坊": ["Q1551411", "Bahnfrend", "CC BY-SA 4.0", "Cathedral_of_Saint_Paul_in_Macau,_2023_(04).jpg"],
    "议事亭前地": ["Q837935", "Андрей Суриков / Andrey Surikov . Original uploader was Сура at ru.wik", "CC BY 2.5", "Centre_of_Makau.jpg"],
    "氹仔旧城区": ["Q7375637", "Iidxplus", "CC BY-SA 3.0", "Rua_do_Cunha.jpg"],
    "义乌国际商贸城": ["Q10877722", "MNXANL", "CC BY-SA 4.0", "201706_Overview_of_Yiwu_International_Trading_Town.jpg"],
    "西湖": ["Q502371", "Louisa Salazar", "CC BY-SA 3.0", "West_Lake_-_Hangzhou,_China.jpg"],
    "灵隐寺": ["Q1070228", "Denis Yuen", "CC BY-SA 2.5", "Lingyin_si.JPG"],
    "龙井村": ["Q6674031", "Tyg728", "CC BY-SA 4.0", "十八棵御茶.jpg"],
    "外滩": ["Q125474", "Georgio", "CC BY-SA 3.0", "Promenade_du_Bund.jpg"],
    "东方明珠": ["Q223207", "Dottie Day", "CC BY 2.0", "Oriental_Pearl_Tower_2012.jpg"],
    "上海中心大厦": ["Q18547", "https://www.pxfuel.com/en/free-photo-ovozr", "CC BY-SA 4.0", "Shanghai_Tower_in_2015_(2).jpg"],
    "豫园": ["Q1328025", "Chainwit.", "CC BY 4.0", "2024-Apr_Shanghai_Yu_Yuan_Garden_豫园_-_img_20.jpg"],
    "南京路步行街": ["Q579977", "Melvin Loi", "CC BY-SA 2.0", "East_Nanjing_Road_2020_(50361842166).jpg"],
    "田子坊": ["Q7800264", "Jonipoon", "CC BY-SA 3.0", "Tianzifangbyday.jpg"],
    "新天地": ["Q1326515", "azureisle", "CC BY 2.0", "Xintiandi6.jpg"],
    "朱家角古镇": ["Q198220", "BrokenSphere", "CC BY-SA 3.0", "Zhujiajiao_canal_4.JPG"],
    "故宫": ["Q80290", "N509FZ", "CC BY-SA 4.0", "Hall_of_Supreme_Harmony_(20241127120000).jpg"],
    "天安门广场": ["Q164055", "N509FZ", "CC BY-SA 4.0", "Tian'anmen_from_the_square_(20200825114150).jpg"],
    "天坛": ["Q125445", "Shujianyang", "CC BY-SA 4.0", "Temple_of_Heaven_20160323_01.jpg"],
    "颐和园": ["Q4132", "xiquinhosilva", "CC BY 2.0", "Longevity_Hill_of_the_Summer_Palace.jpg"],
    "慕田峪长城": ["Q212610", "Velatrix", "CC0", "Great_Wall_of_China_July_2006.JPG"],
    "南锣鼓巷": ["Q9529545", "Francisco Anzola", "CC BY 2.0", "Nanluogu_Xiang_(6230757826).jpg"],
    "798艺术区": ["Q1203470", "Leeluv", "CC BY-SA 3.0", "Space-gallery_798-art-district.jpg"],
    "秀水街": ["Q3435628", "維基小霸王", "CC BY-SA 4.0", "秀水街_2022.jpg"],
    "北京烤鸭 全聚德 前门店": ["Q3269017", "einalem", "CC BY-SA 2.0", "Carving_up_our_duck.jpg"],
    "黄鹤楼": ["Q462372", "MonsieurRoi", "CC BY-SA 3.0", "CN_-_Hubei_-_Wuhan_-_Kranichpagode.jpg"],
    "武汉长江大桥": ["Q8039097", "KongFu Wang", "CC BY-SA 2.0", "Wuhan_Yangtze_River_Bridge.jpg"],
    "汉口江滩": ["Q11134638", "", "CC BY-SA 3.0", "China_Wuhan_Jianghanguan.jpg"],
    "湖北省博物馆": ["Q4391403", "", "CC BY-SA 3.0", "Hubei_Provincial_Museum.JPG"],
    "归元寺": ["Q5616939", "gugganij", "CC BY-SA 3.0", "Guiyuan_temple_Wuhan2.jpg"],
    "趵突泉": ["Q4857485", "Windmemories", "CC BY-SA 4.0", "Baotu_Spring,_Jinan_in_Oct_2013.jpg"],
    "大明湖": ["Q2616386", "Song Hongxiao", "CC BY-SA 3.0", "Daminglake_from_west_2007.jpg"],
    "黑虎泉": ["Q4922051", "Amphylite", "CC BY-SA 3.0", "Black_tiger_spring.jpg"],
    "千佛山": ["Q2208134", "Rolf Müller ( User:Rolfmueller )", "CC BY-SA 3.0", "Qianfoshan_ridge.jpg"],
    "山东博物馆": ["Q4132844", "Baomi", "CC BY-SA 4.0", "Shandong_Museum_Building.jpg"],
    "泰山": ["Q216059", "Charlie fong", "Domínio público", "泰山_南天门.jpg"],
    "星光大道": ["Q782876", "", "CC BY-SA 2.0", "Avenue_of_Stars_Hong_Kong_Bruce_Lee_Statue.jpg"],
    "妈阁庙": ["Q2149114", "", "Domínio público", "Templo_de_A-Má.JPG"],
    "澳门旅游塔": ["Q1568304", "Yumeto", "CC BY-SA 4.0", "20250816_Torre_de_Macau.jpg"],
    "澳门威尼斯人": ["Q1156708", "Jimmy Yao (vixyao) on Flickr", "CC BY-SA 2.0", "Venetian_Macau.jpg"],
    "东湖": ["Q845631", "gugganij", "CC BY-SA 3.0", "Ostsee_Wuhan_3.jpg"],
    "江汉路步行街": ["Q11134650", "User:Vmenkov", "CC BY-SA 3.0", "Hankou-Hanjiang-Lu-0247.jpg"],
    "花城广场": ["c5e0b38096e", "钉钉", "CC BY-SA 4.0", "Huacheng_Square,_Guangzhou.jpg"],
    "锦绣中华民俗村": ["ccca801df48", "Abasaa", "Domínio público", "Night_at_Splendid_China_Folk_Village_01.JPG"],
    "华侨城创意文化园": ["cfc65606512", "Dinkun Chen", "CC BY-SA 4.0", "OCT_LOFT,_SHENZHEN_(47).jpg"],
    "天星小轮": ["ce377c75dc6", "Bahnfrend", "CC BY-SA 4.0", "Solar_Star,_Victoria_Harbour,_2006_(01).jpg"],
    "河坊街": ["cc476e8ad86", "钉钉", "CC BY-SA 4.0", "Hefang_Street,_Hangzhou.jpg"],
    "楚河汉街": ["cca57b2b700", "Doraemon.tvb", "CC BY-SA 3.0", "Chuhe_Hanjie_Night_01.jpg"],
    "芙蓉街": ["c46159a0ca1", "Reinhold Möller Ermell", "CC BY-SA 4.0", "Jinan_Furong_Fußgängerzone-20150519-RM-191555.jpg"],
    "宾王夜市": ["c637c5e71ba", "Ariel Palmon", "CC BY-SA 3.0", "Yiwu_night_market_ap_002.jpg"],
    "北京路步行街": ["cb4da56757d", "Windmemories", "CC BY-SA 4.0", "20250222_Street_scene_of_Beijing_Road_03.jpg"],
    "顺德美食 大良": ["cc0fa4c7733", "Lau Hau Yatyue Tiger", "CC0", "GD_廣東_Guangdong_佛山_Foshan_順德_Shunde_華蓋路_Huagai_Road_shop_民信老店_Minxin_Lao_Dian_甜品_Dessert_white_food_雙皮燉奶_Double_skin_milk_bowels_January_2024_R12S_05.jpg"],
    "户部巷": ["c45feb47fd2", "Howchou", "CC BY-SA 3.0", "Hubu_Xiang_1.jpg"],
    "岭南天地": ["c4c392c8a64", "Uuongkinghe", "CC BY-SA 4.0", "龙生九子_20240215.jpg"],
    "五龙潭": ["c6b93975a4a", "Steven Sun", "CC BY-SA 4.0", "Five_Dragon_Pool_20260422_02.jpg"],
    "宽厚里": ["c7121082ff5", "Steven Sun", "CC BY-SA 4.0", "Far_view_of_Jinan_Kuanhouli_20170824.jpg"],
  };

  const TOURISM = { CITIES, PLACES, PHOTOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = TOURISM;
  else root.TOURISM = TOURISM;
})(typeof self !== 'undefined' ? self : this);
