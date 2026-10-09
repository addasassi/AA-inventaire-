/* =====================================================================
   Bureaux ZR Express — liste (mise à jour du 25/09/2024) + recherche,
   copie de l'adresse et modification (enregistrée dans Firestore :
   meta/zrBureaux). Dépend de : db, currentUser, toast (index.html)
   ===================================================================== */
(function(){
  // [n° wilaya, wilaya FR, wilaya AR, bureau FR, bureau AR, adresse FR, adresse AR, n° commercial, n° réclamation, stop desk]
  const DEFAULT = [
    [1,'Adrar','أدرار','Adrar','أدرار','À côté du lycée El Moghili, derrière le conseil judiciaire','بجوار ثانوية المغيلي، خلف مجلس القضاء','0661.41.11.00','0661.11.00.53','0661.41.11.00'],
    [2,'Chlef','الشلف','Chlef','الشلف','Hay Aroudj - derrière A.D.E, en face le musée','حي عروج - خلف المديرية الجزائرية للمياه، مقابل المتحف','0770.99.45.28','0770.99.46.75','0770.99.46.74'],
    [2,'Chlef','الشلف','Ténès','تنس','N°6 commune de Ténès A, Rue Boufadis, Lot 51 Bâtiments - à côté de la caserne militaire, Route Marina, Bâtiments Mandil','رقم 6 بلدية تنس A، شارع بوفاديس حصة 51 عمارة - بجانب الثكنة العسكرية، طريق مارينة عمارات منديل','0770.99.35.71','0770.99.45.62','0770.99.35.72'],
    [3,'Laghouat','الأغواط','Laghouat','الأغواط','Cité Mhafir - en face parking du département de biologie','','0770.05.34.49','0770.73.56.83','0670.30.03.97'],
    [4,'Oum El Bouaghi','أم البواقي','Aïn El Beïda','عين البيضاء','Tahsise El Amel, en face le collège Koshari, Aïn El Beïda, Oum El Bouaghi','تحصيص الأمل - مقابل متوسطة كوشاري، عين البيضاء، أم البواقي','0698.63.12.34','0660.73.74.74','0660.73.74.78'],
    [4,'Oum El Bouaghi','أم البواقي','Oum El Bouaghi - Centre ville','أم البواقي - المدينة','N°392 cité Ennacer','رقم 392 حي الناصر','0698.63.12.34','0672.96.10.16','0770.07.29.11'],
    [5,'Batna','باتنة','Batna','باتنة','Les allées Jadida Erriad - à côté supérette El Bahja','الرياض - بجانب سوبيرات البهجة','0659.78.12.34','0770.55.52.45','0770.55.80.86 / 0770.59.90.81 / 0770.61.01.55'],
    [6,'Béjaïa','بجاية','Béjaïa','بجاية','Edimco, Cité Somacob','ايدمكو حي سوماكوب','0698.86.12.34','0770.60.34.02','0770.14.38.12'],
    [6,'Béjaïa','بجاية','Akbou','أقبو','Gare ferroviaire, à côté salle des fêtes Hadad','محطة السكة الحديدية، أمام قاعة الحفلات حداد','0770.10.46.84','0770.10.45.78','0770.10.46.92 / 0770.10.48.23'],
    [7,'Biskra','بسكرة','Biskra','بسكرة','El Koures - en face salle des fêtes Soukara','القرص - مقابل قاعة الحفلات سكرة','0771.53.40.58 / 0658.92.66.62','0671.99.66.54','0770.72.87.34 / 0667.66.28.94'],
    [8,'Béchar','بشار','Béchar','بشار','Cité 220 log - à côté de CNRC','حي 220 مسكن - بجانب مقر السجل التجاري','0770.05.94.98','0673.89.23.26','0770.76.53.73'],
    [9,'Blida','البليدة','Blida - Ville','البليدة - وسط المدينة','Cité Ben Mokadem Mohammed N°276 - Ramoul, en face l\'agence','حي بن مقدم محمد - الرامول، مقابل محطة الحافلات','','0770.77.21.11','0799.71.81.02'],
    [9,'Blida','البليدة','Bougara','بوقرة','Rue Hamidouche Mouloud, Route d\'Alger, Bougara','بوقرة، شارع حميدوش مولود، طريق الجزائر العاصمة','0771.92.80.94','0770.77.21.11','0779.42.62.22'],
    [9,'Blida','البليدة','Mouzaïa','موزاية','Rue Ben Ahmed Ali Aslaoui, N°45, Mouzaïa','موزاية، شارع بن أحمد علي عسلاوي','0774.53.19.22','0770.77.21.11','0773.86.25.07'],
    [10,'Bouira','البويرة','Bouira','البويرة','338 log - en face de l\'hôtel Sofy','338 مسكن - مقابل فندق صوفي','0657.70.05.64','0770.38.18.12','0770.77.87.43 / 0770.82.89.97 / 0558.68.92.30'],
    [11,'Tamanrasset','تمنراست','Tamanrasset','تمنراست','Cité El Wiam - en face CASNOS','حي الوئام - مقابل الضمان الاجتماعي','0770.99.42.57','0770.99.46.06','0670.74.39.61'],
    [12,'Tébessa','تبسة','Tébessa','تبسة','Tahsis El Arebi El Tebsi (Skanska), en face la Direction de la Poste d\'Algérie de Tébessa','تحصيص العربي التبسي (سكنسكا)، مقابل المديرية الولائية لبريد الجزائر تبسة','0659.43.06.81','0775.64.75.14','0779.87.30.36'],
    [13,'Tlemcen','تلمسان','Tlemcen','تلمسان','En face rond-point cité des Oliviers','أمام محور الدوران حي الزيتون','0772.02.93.89','0770.39.69.54','0698.53.00.13 / 0794.03.11.43'],
    [14,'Tiaret','تيارت','Tiaret','تيارت','Route l\'académie, en face de l\'hôpital du rein - à côté de la librairie Mimouni','طريق لكاديمي، مقابل مستشفى الكلى - بجانب مكتبة ميموني','0667.18.42.55','0699.89.72.01','0770.38.32.20 / 0770.07.28.15 / 0770.82.85.87'],
    [15,'Tizi Ouzou','تيزي وزو','Tizi Ouzou','تيزي وزو','Cité 2000, nouvelle ville, bâtiment 2','حي 2000 مسكن، المدينة الجديدة، عمارة رقم 02','0770.18.06.02','0770.59.99.01','0770.18.06.02'],
    [16,'Alger','الجزائر','Birkhadem','بئر خادم','Rue des Rosiers, El Malha, Birkhadem','عين المالحة بئر خادم - بالقرب من مركز إيداع التأشيرة لتركيا','0770.70.50.07 / 0770.60.18.36','0770.56.66.68 / 0770.78.06.10','0770.58.40.33'],
    [16,'Alger','الجزائر','Ouled Fayet','أولاد فايت','Ouled Fayet - pas loin du restaurant Zouhair','أولاد فايت - بالقرب من مطعم زهير','0770.07.27.03','0770.07.22.26','0770.06.94.04'],
    [16,'Alger','الجزائر','Réghaïa','الرغاية','Résidence la Paix A69 - en face la mosquée DNC','إقامة السلام 69 - مقابل مسجد DNC','0799.57.57.15','0770.19.72.98','0770.21.54.48'],
    [16,'Alger','الجزائر','Bordj El Kiffan','برج الكيفان','Lido - pas loin du stade de tennis','الليدو برج الكيفان - بالقرب من ملعب التنس','0770.36.39.02','0770.37.67.30','0770.36.39.02'],
    [16,'Alger','الجزائر','Birtouta','بئر توتة','Cité des anciens abattoirs - derrière la poste - Birtouta','حي الباطوار القديم - خلف بريد الجزائر - بئر توتة','0770.93.49.22','0776.06.26.54','0776.06.31.54'],
    [17,'Djelfa','الجلفة','Djelfa','الجلفة','Cité Berbih - à côté de la Direction de l\'action sociale et de la solidarité (DASS)','حي بربيح - بجانب مديرية الشؤون الاجتماعية والتضامن DASS','0657.70.01.76','0770.45.16.00','0770.28.29.35'],
    [18,'Jijel','جيجل','Jijel','جيجل','Cité Konchovali - 190 log, bâtiment 07 - 70 m Gulf Bank','حي كونشوفالي - 190 مسكن عمارة 07 - 70 م تحت بنك الخليج','0657.64.62.84','0657.25.44.90','0660.16.93.08 / 0660.09.76.26'],
    [18,'Jijel','جيجل','Taher','الطاهير','Boukaabour, la route menant à la clinique d\'ophtalmologie Mahanan','بوكعبور، الطريق المؤدي إلى عيادة طب العيون محنان','0670.42.32.04','0770.36.76.18','0670.42.32.05'],
    [19,'Sétif','سطيف','Sétif - Ville','سطيف - وسط المدينة','Cité Dallas 3ème tranche - à côté de la maison LG et IRIS','حي دالاس الشطر 3 - بجانب LG و IRIS','0770.78.80.97','0549.66.41.74','0770.18.85.05 / 0770.93.15.53 / 0541.50.02.37'],
    [19,'Sétif','سطيف','El Eulma','العلمة','Logements covalente - derrière hôtel Rif, à côté de la mosquée Imam Chafei','حي التساهمي - خلف فندق الريف وبجانب مسجد الإمام الشافعي','0770.78.80.97','0770.33.99.75','0770.80.40.09'],
    [20,'Saïda','سعيدة','Saïda','سعيدة','Cité 5 Juillet - en face la pharmacie 5 Juillet','حي 5 جويلية - أمام صيدلية 5 جويلية','0795.27.12.65','0770.80.87.91','0770.39.16.95 / 0779.21.46.31'],
    [21,'Skikda','سكيكدة','Skikda','سكيكدة','Cité Mohammed Namous N°02, Mag 02 - pas loin de Hammam Derradji','حي محمد ناموس - بالقرب من حمام دراجي','0770.30.88.09','0792.43.57.32','0773.85.06.22 / 0793.54.04.47'],
    [22,'Sidi Bel Abbès','سيدي بلعباس','Sidi Bel Abbès','سيدي بلعباس','Benhamouda - en face l\'école Feraoune Miloud','بن حمودة - مقابل مدرسة فرعون ميلود','0778.15.20.27','0773.98.12.87','0773.57.93.68'],
    [23,'Annaba','عنابة','Annaba 1','عنابة 1','Rue l\'Avant-Port - à côté de la supérette Ben Amara','طريق قبل الميناء - جانب سوبيرات بن عمارة','0770.35.07.90','0796.36.96.89','0657.81.29.59 / 0660.97.79.32 / 0660.90.47.91 / 0770.27.05.40'],
    [23,'Annaba','عنابة','Annaba 2 - El Bouni','عنابة 2 - البوني','El Bouni - en face Algérie Télécom','بلدية البوني، وسط المدينة، مقابل اتصالات الجزائر','0797.40.57.33','0796.36.96.89','0770.29.99.73'],
    [24,'Guelma','قالمة','Guelma','قالمة','À côté de la cafétéria La Fontaine','بجانب مقهى La Fontaine','0791.48.22.66','0791.61.67.69','0770.96.22.21'],
    [25,'Constantine','قسنطينة','Constantine 1','قسنطينة 1','Cité Tlemcen, 72, Zouaghi Slimane','حي تلمسان - الزواغي سليمان','0770.77.71.59','0770.60.14.05','0770.54.53.05'],
    [25,'Constantine','قسنطينة','Constantine 2 - Ali Mendjeli','قسنطينة 2 - علي منجلي','Zone industrielle, Nouvelle ville Ali Mendjeli','المنطقة الصناعية، المدينة الجديدة علي منجلي','0770.77.71.59','0770.60.14.05','0770.14.49.99 / 0770.07.29.10'],
    [25,'Constantine','قسنطينة','Constantine 3 - Belle vue','قسنطينة 3 - المنظر الجميل','Belle vue','المنظر الجميل','0770.77.71.59','0770.60.14.05','0770.79.60.44 / 0770.79.60.24 / 0770.79.60.22'],
    [26,'Médéa','المدية','Médéa','المدية','Beziwech, rue Takhabit - au-dessous du cabinet de gynécologie Dr Khelifi','بزيوش طريق تاخابيت - تحت عيادة طب النساء د. خليفي','0779.46.02.70','0779.46.02.70','0660.65.10.15'],
    [27,'Mostaganem','مستغانم','Mostaganem','مستغانم','Cité Colonel Amirouche - en face du tribunal','حي العقيد عميروش - مقابل المحكمة الإدارية','0670.26.92.10','0676.73.07.94','0660.67.37.78'],
    [28,'M\'Sila','المسيلة','M\'Sila','المسيلة','Cité Cheikh Mokrani - à côté de la mosquée Aïcha Oum El Mouminine','طريق الشيخ المقراني - بجانب مسجد عائشة أم المؤمنين','0770.64.16.63','0770.82.41.31','0770.52.29.72 / 0770.37.80.33'],
    [28,'M\'Sila','المسيلة','Bou Saâda','بوسعادة','Cité Hadhaba, Route Mohamed Atik N° 52/11, Bou Saâda - à côté de la branche municipale','بوسعادة - بجانب الفرع البلدي','0770.29.78.55','0770.19.11.46','0770.29.78.57'],
    [29,'Mascara','معسكر','Mascara','معسكر','Rue Mahour Mahie Eddine - en face les pompiers','شارع مهور محي الدين - طريق الرمان، مقابل مركز الإطفاء','0668.05.25.17','0772.03.23.02','0793.57.76.79 / 0773.21.84.45'],
    [30,'Ouargla','ورقلة','Ouargla','ورقلة','Cité Tazegrar - à côté hôtel de police','حي تازقرارت - بالقرب من فندق الشرطة','0770.50.50.30 / 0770.50.50.29','0770.61.21.03','0676.50.68.79'],
    [30,'Ouargla','ورقلة','Hassi Messaoud','حاسي مسعود','Cité AADL 200 - à côté de la CASNOS','حي عدل 200 - بجانب مقر الضمان الاجتماعي','0770.50.50.30 / 0770.50.50.29','0770.55.88.88','0675.06.52.53'],
    [31,'Oran','وهران','Oran 1 - El Morchid','وهران 1 - المرشد','El Morchid - à côté des magasins d\'électroménagers','المرشد - أمام محل الأجهزة الكهرومنزلية','0770.39.52.00','0770.60.65.24 / 0770.77.10.89','0770.12.84.13 / 0770.79.39.20 / 0770.96.37.28 / 0770.76.50.07'],
    [31,'Oran','وهران','Oran 2 - Millénium','وهران 2 - ميلينيوم','Millénium - en face la supérette Prix Choc','ميلينيوم - مقابل سوبيرات Prix Choc','0770.60.13.17','0770.60.65.24 / 0770.77.10.89','0770.76.80.77 / 0770.67.50.07'],
    [31,'Oran','وهران','Oran 3 - Maraval','وهران 3 - مارافال','Derrière le magasin Look de Maraval','مارافال، خلف محل Look','0770.16.96.59','0770.16.96.51','0770.16.99.93'],
    [32,'El Bayadh','البيض','El Bayadh','البيض','Cité ancien stade - à côté de l\'huissier de justice Djouadi Malika','حي الملعب القديم - بجانب المحضر القضائي جوادي مليكة','0770.22.96.32','0773.03.81.76','0770.22.96.32'],
    [34,'Bordj Bou Arreridj','برج بوعريريج','Bordj Bou Arreridj','برج بوعريريج','Cité Boumergued - en face la clinique Akhrouf','حي بومرقد - مقابل عيادة أخروف','0770.70.91.66','0770.27.23.17','0770.42.76.33 / 0770.37.23.20'],
    [35,'Boumerdès','بومرداس','Boumerdès','بومرداس','Rue Mohamed El Mahdi, sur le chemin de l\'hôtel Les Lilas','شارع محمد المهدي - الطريق المؤدي إلى فندق Les Lilas','0773.74.98.99','0783.39.56.68','0775.43.54.33 / 0791.93.51.00'],
    [35,'Boumerdès','بومرداس','Bordj Menaïel','برج منايل','Coopérative El Ghazali, cité 20 Août, Bordj Menaïel - en face Dr Sadji','التعاونية العقارية الغزالي، حي 20 أوت، برج منايل - مقابل د. ساجي','0775.06.72.89','0553.16.17.89','0553.05.92.69'],
    [36,'El Tarf','الطارف','El Tarf','الطارف','Rue Khemis Tine - en face le premier arrondissement','حي خميس تين - مقابل الأمن الحضري الأول','0697.17.71.93','0770.61.27.04','0770.40.36.47 / 0795.74.24.83'],
    [39,'El Oued','الوادي','El Oued','وادي سوف','Cité Sidi Abdellah, derrière la poste','حي سيدي عبد الله - خلف مركز البريد','0791.69.99.02','0660.97.70.78','0698.90.15.50'],
    [41,'Souk Ahras','سوق أهراس','Souk Ahras','سوق أهراس','Route nationale N°16, Les Sapins','حي تعاونية الياسمين - فوق الصندوق الوطني للتقاعد CNR - سوق أهراس','0792.27.06.61','0795.94.98.08','0770.96.16.15'],
    [42,'Tipaza','تيبازة','Tipaza','تيبازة','La nouvelle AADL 1700 - en face l\'ONPS','حي عدل 1700 - مقابل الديوان الوطني للمطبوعات','0770.42.07.24','0770.20.04.60','0770.92.31.37'],
    [42,'Tipaza','تيبازة','Koléa','القليعة','Route d\'Alger, à côté du café de Verre','طريق الجزائر، بجانب قهوة الزجاج','0551.20.04.59','0551.20.05.46','0551.21.06.91'],
    [43,'Mila','ميلة','Mila','ميلة','Jamouaa Milkia N°34 - à côté de l\'agence Sonelgaz','تحت مستشفى الإخوة مغلاوي - حوالي 100 متر، بجانب الوكالة التجارية سونلغاز','0657.22.47.73','0659.52.53.82 / 031.46.37.30','0660.90.94.48 / 0660.16.93.28'],
    [44,'Aïn Defla','عين الدفلى','Aïn Defla','عين الدفلى','Rond-point cycliste - en face la daïra','محور الدوران السيكليست - أمام مقر الدائرة','0770.99.42.68','0770.99.45.79','0770.99.45.81'],
    [45,'Naâma','النعامة','Naâma','النعامة','Route nationale N°6, en face de l\'hôtel Al-Amin','الطريق الوطني رقم 6 سابقا، مقابل فندق الأمين','0699.29.60.40','0659.26.93.47','0770.03.39.23'],
    [46,'Aïn Témouchent','عين تموشنت','Aïn Témouchent','عين تموشنت','Hai Ezzitoun - à côté de la mosquée Oussama Abu Zaid (El Bechari)','حي الزيتون - بالقرب من مسجد أسامة أبو زيد البشاري','0770.76.66.82','0770.54.88.78','0770.76.66.90'],
    [47,'Ghardaïa','غرداية','Ghardaïa','غرداية','Hadj Messaoud, en face du commissariat de police et de la protection civile','حاج مسعود، مقابل مركز الشرطة والحماية المدنية','0770.50.50.18','0774.72.81.01','0791.54.44.40 / 0699.62.63.10'],
    [48,'Relizane','غليزان','Relizane','غليزان','Îlot 183, Boulevard de la République N°45, centre-ville','','0770.96.40.17','0770.96.40.59','0770.96.40.52 / 0770.96.40.53'],
    [51,'Ouled Djellal','أولاد جلال','Ouled Djellal','أولاد جلال','Rue Mithana - à côté de la maison de jeunes','','0770.02.95.05','0770.01.63.08','0770.01.70.55'],
    [52,'Béni Abbès','بني عباس','Béni Abbès','بني عباس','Cité El Moustakbel - en face de la nouvelle annexe de l\'APC et du nouveau siège de la Banque d\'Algérie','حي المستقبل - مقابل الفرع البلدي والبنك الجزائري الجديد','0662.56.67.02','0662.56.67.02','0656.92.83.39'],
    [55,'Touggourt','تقرت','Touggourt','تقرت','Cité Sidi Abdessalem - entre BEA et CPA','حي سيدي عبد السلام - بين BEA و CPA','0791.69.99.02','0795.81.58.86','0663.66.64.22 / 0660.97.70.85']
  ];
  const KEYS = ['n','w','wa','name','nameAr','addr','addrAr','com','rec','desk'];
  const toObj = (a, i)=>{ const o = {id:'b'+i}; KEYS.forEach((k,j)=> o[k] = a[j]); return o; };
  let list = DEFAULT.map(toObj);
  let loaded = false, query = '';

  const YELLOW = '#FFCC00', DARK = '#1b1b1b';
  function isAdmin(){ return typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin'; }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/['’\-]/g,' ').replace(/\s+/g,' ').trim(); }
  function phones(s){ return String(s||'').split(/[\/,]/).map(x=>x.trim()).filter(Boolean); }
  function telHref(p){ return 'tel:' + p.replace(/[^\d+]/g,''); }
  // WhatsApp : 0662… → 213662…
  function waHref(p){ let d = p.replace(/\D/g,''); if(d.startsWith('00')) d = d.slice(2); else if(d.startsWith('0')) d = '213' + d.slice(1); return 'https://wa.me/' + d; }
  const WA_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.62.71.23 1.36.2 1.87.12.57-.08 1.75-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.04 21.5h-.01a9.4 9.4 0 01-4.8-1.32l-.34-.2-3.57.94.95-3.48-.22-.36a9.42 9.42 0 1117.4-5.02 9.43 9.43 0 01-9.41 9.44zm8.03-17.46A11.27 11.27 0 0012.04.75C5.8.75.72 5.83.72 12.07c0 2 .52 3.94 1.51 5.65L.62 23.6l6.03-1.58a11.3 11.3 0 005.39 1.37h.01c6.24 0 11.32-5.08 11.32-11.32 0-3.02-1.18-5.87-3.3-8.03z"/></svg>';

  async function load(){
    try{
      if(typeof db === 'undefined' || !db) return;
      const d = await db.collection('meta').doc('zrBureaux').get();
      if(d.exists && Array.isArray(d.data().list) && d.data().list.length) list = d.data().list;
    }catch(e){}
    loaded = true;
  }
  async function save(){
    await db.collection('meta').doc('zrBureaux').set({list, updatedAt: new Date().toISOString(), by: (currentUser && (currentUser.name || currentUser.username)) || ''});
  }

  function css(){
    if(document.getElementById('zr-css')) return;
    const st = document.createElement('style'); st.id = 'zr-css';
    st.textContent = `
      #zrPage{padding-bottom:30px;}
      .zr-hero{background:${YELLOW};color:${DARK};border-radius:18px;padding:16px 16px 14px;margin-bottom:12px;position:relative;overflow:hidden;}
      .zr-hero:after{content:"";position:absolute;right:-30px;top:-30px;width:120px;height:120px;border-radius:50%;background:rgba(0,0,0,.06);}
      .zr-hero .zr-logo{font-weight:900;font-size:22px;letter-spacing:.5px;font-style:italic;}
      .zr-hero .zr-logo span{background:${DARK};color:${YELLOW};padding:0 7px;border-radius:6px;margin-right:4px;font-style:normal;}
      .zr-hero .zr-sub{font-size:13px;font-weight:700;margin-top:4px;opacity:.8;}
      .zr-search{display:flex;gap:8px;position:sticky;top:0;z-index:5;background:var(--cream,#f6efe9);padding:6px 0 10px;}
      .zr-search input{flex:1;min-width:0;padding:13px 14px;border-radius:14px;border:2px solid ${YELLOW};font-size:15px;background:#fff;color:${DARK};box-sizing:border-box;}
      .zr-search button{flex:0 0 auto;border:none;border-radius:14px;background:${DARK};color:${YELLOW};font-weight:800;padding:0 14px;font-size:20px;}
      .zr-count{font-size:12.5px;font-weight:700;color:#7a6a5a;margin:0 2px 8px;}
      .zr-wil{margin-bottom:14px;}
      .zr-wil-h{display:flex;align-items:center;gap:10px;margin:4px 2px 8px;}
      .zr-num{flex:0 0 auto;min-width:38px;height:38px;border-radius:11px;background:${DARK};color:${YELLOW};font-weight:900;font-size:16px;display:flex;align-items:center;justify-content:center;}
      .zr-wil-h .zr-wn{font-weight:800;font-size:16px;color:${DARK};}
      .zr-wil-h .zr-wa{font-size:14px;color:#6b5d50;margin-inline-start:auto;}
      .zr-card{background:#fff;border:1px solid #eadfd3;border-left:6px solid ${YELLOW};border-radius:14px;padding:12px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,.05);}
      .zr-card .zr-bn{display:flex;justify-content:space-between;gap:8px;align-items:baseline;font-weight:800;color:${DARK};font-size:15px;}
      .zr-card .zr-bn small{font-weight:700;color:#6b5d50;font-size:13px;}
      .zr-addr{font-size:13.5px;color:#333;margin-top:6px;line-height:1.45;}
      .zr-addr-ar{font-size:14px;color:#333;margin-top:4px;line-height:1.5;direction:rtl;text-align:right;}
      .zr-ph{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;}
      .zr-ph a{display:inline-flex;align-items:center;gap:4px;text-decoration:none;font-size:12.5px;font-weight:700;padding:5px 9px;border-radius:999px;background:#fff7d1;color:${DARK};border:1px solid #f1df8a;}
      .zr-ph a.desk{background:${YELLOW};border-color:${YELLOW};}
      .zr-rec{display:inline-flex;align-items:center;gap:6px;}
      .zr-ph a.wa{width:36px;height:36px;padding:0;justify-content:center;border-radius:50%;background:#25D366;border-color:#25D366;box-shadow:0 2px 6px rgba(37,211,102,.35);}
      .zr-ph .lbl{font-size:10.5px;font-weight:800;opacity:.65;}
      .zr-act{display:flex;gap:6px;margin-top:10px;}
      .zr-act button{flex:1;border:none;border-radius:11px;padding:11px 8px;font-weight:800;font-size:13.5px;}
      .zr-copy{background:${DARK};color:${YELLOW};}
      .zr-copy.ok{background:#1e7b45;color:#fff;}
      .zr-edit{flex:0 0 auto !important;background:#f3ece4;color:${DARK};padding:11px 13px !important;}
      .zr-add{width:100%;border:2px dashed ${DARK};background:#fffbe6;color:${DARK};border-radius:14px;padding:13px;font-weight:800;font-size:14px;margin-top:6px;}
      .zr-empty{text-align:center;padding:30px 10px;color:#7a6a5a;font-weight:700;}
      #zrModal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center;}
      #zrModal .zr-m{background:#fff;width:100%;max-width:520px;max-height:90vh;overflow:auto;border-radius:20px 20px 0 0;padding:16px;box-sizing:border-box;border-top:6px solid ${YELLOW};}
      #zrModal h3{margin:0 0 10px;color:${DARK};}
      #zrModal label{display:block;font-size:12px;font-weight:800;color:#6b5d50;margin:9px 0 3px;}
      #zrModal input,#zrModal textarea{width:100%;box-sizing:border-box;border:1px solid #e3d6c8;border-radius:10px;padding:10px;font-size:14px;font-family:inherit;color:${DARK};background:#fff;}
      #zrModal textarea{min-height:62px;resize:vertical;}
      #zrModal .row2{display:flex;gap:8px;} #zrModal .row2>div{flex:1;min-width:0;}
      #zrModal .zr-mb{display:flex;gap:8px;margin-top:14px;}
      #zrModal .zr-mb button{flex:1;border:none;border-radius:12px;padding:13px;font-weight:800;font-size:14px;}
      #zrModal .sv{background:${DARK};color:${YELLOW};} #zrModal .cl{background:#f3ece4;color:${DARK};} #zrModal .dl{background:#fbe3e0;color:#b3261e;flex:0 0 auto !important;padding:13px 14px !important;}
    `;
    document.head.appendChild(st);
  }

  function copyText(b){
    const lines = ['📍 Bureau ZR Express — ' + b.name + ' (' + String(b.n).padStart(2,'0') + ' ' + b.w + ')'];
    if(b.addr) lines.push(b.addr);
    if(b.addrAr) lines.push(b.addrAr);
    return lines.join('\n');
  }
  async function doCopy(txt, btn){
    let ok = false;
    try{ await navigator.clipboard.writeText(txt); ok = true; }catch(e){
      try{ const t = document.createElement('textarea'); t.value = txt; t.style.position='fixed'; t.style.opacity='0'; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); }catch(_){}
    }
    if(ok){ btn.classList.add('ok'); btn.textContent = '✅ Adresse copiée'; setTimeout(()=>{ btn.classList.remove('ok'); btn.textContent = '📋 Copier l\'adresse'; }, 1800); }
    else toast('Copie impossible', true);
  }

  function matches(b, q){
    if(!q) return true;
    const qn = norm(q);
    if(/^\d{1,2}$/.test(qn)) return Number(qn) === Number(b.n);
    const hay = norm([b.n, String(b.n).padStart(2,'0'), b.w, b.wa, b.name, b.nameAr, b.addr, b.addrAr].join(' '));
    return qn.split(' ').every(t=> hay.includes(t));
  }

  function render(){
    const wrap = document.getElementById('zrPage');
    if(!wrap) return;
    css();
    const keep = document.getElementById('zr-q');
    const hadFocus = keep && document.activeElement === keep;
    const pos = keep ? keep.selectionStart : null;
    const items = list.filter(b=> matches(b, query)).sort((a,b)=> (a.n - b.n));
    const groups = [];
    items.forEach(b=>{ let g = groups[groups.length-1]; if(!g || g.n !== b.n){ g = {n:b.n, w:b.w, wa:b.wa, items:[]}; groups.push(g); } g.items.push(b); });
    const wilCount = new Set(list.map(b=>b.n)).size;
    let html = `<div class="zr-hero"><div class="zr-logo"><span>ZR</span>EXPRESS</div><div class="zr-sub">🚚 ${list.length} bureaux · ${wilCount} wilayas — البريد السريع</div></div>
      <div class="zr-search"><input id="zr-q" type="search" inputmode="search" placeholder="🔎 N°, wilaya ou commune…" value="${esc(query)}"><button id="zr-clear" title="Effacer">✕</button></div>`;
    if(query) html += `<div class="zr-count">${items.length} bureau${items.length>1?'x':''} trouvé${items.length>1?'s':''}</div>`;
    if(!items.length) html += `<div class="zr-empty">Aucun bureau trouvé pour « ${esc(query)} »</div>`;
    groups.forEach(g=>{
      html += `<div class="zr-wil"><div class="zr-wil-h"><div class="zr-num">${String(g.n).padStart(2,'0')}</div><div class="zr-wn">${esc(g.w)}</div><div class="zr-wa">${esc(g.wa)}</div></div>`;
      g.items.forEach(b=>{
        const ph = [];
        phones(b.desk).forEach(p=> ph.push(`<a class="desk" href="${telHref(p)}"><span class="lbl">STOP DESK</span> ${esc(p)}</a>`));
        phones(b.com).forEach(p=> ph.push(`<a href="${telHref(p)}"><span class="lbl">COMMERCIAL</span> ${esc(p)}</a>`));
        phones(b.rec).forEach(p=> ph.push(`<span class="zr-rec"><a href="${telHref(p)}"><span class="lbl">RÉCLAMATION</span> ${esc(p)}</a><a class="wa" href="${waHref(p)}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp ${esc(p)}">${WA_ICON}</a></span>`));
        html += `<div class="zr-card">
          <div class="zr-bn"><span>${esc(b.name)}</span><small>${esc(b.nameAr)}</small></div>
          ${b.addr ? `<div class="zr-addr">${esc(b.addr)}</div>` : ''}
          ${b.addrAr ? `<div class="zr-addr-ar">${esc(b.addrAr)}</div>` : ''}
          ${ph.length ? `<div class="zr-ph">${ph.join('')}</div>` : ''}
          <div class="zr-act"><button class="zr-copy" data-id="${esc(b.id)}">📋 Copier l'adresse</button>${isAdmin() ? `<button class="zr-edit" data-id="${esc(b.id)}" title="Modifier">✏️</button>` : ''}</div>
        </div>`;
      });
      html += `</div>`;
    });
    if(isAdmin()) html += `<button class="zr-add" id="zr-add">+ Ajouter un bureau</button>`;
    wrap.innerHTML = html;
    const q = document.getElementById('zr-q');
    q.addEventListener('input', ()=>{ query = q.value; render(); });
    if(hadFocus){ q.focus(); try{ q.setSelectionRange(pos, pos); }catch(e){} }
    document.getElementById('zr-clear').onclick = ()=>{ query = ''; render(); document.getElementById('zr-q').focus(); };
    wrap.querySelectorAll('.zr-copy').forEach(btn=> btn.onclick = ()=>{ const b = list.find(x=>x.id===btn.dataset.id); if(b) doCopy(copyText(b), btn); });
    wrap.querySelectorAll('.zr-edit').forEach(btn=> btn.onclick = ()=> openEdit(btn.dataset.id));
    const add = document.getElementById('zr-add'); if(add) add.onclick = ()=> openEdit(null);
  }

  function openEdit(id){
    if(!isAdmin()) return;
    const b = id ? list.find(x=>x.id===id) : {id:'b'+Date.now(), n:'', w:'', wa:'', name:'', nameAr:'', addr:'', addrAr:'', com:'', rec:'', desk:''};
    if(!b) return;
    const m = document.createElement('div'); m.id = 'zrModal';
    const f = (k, label, ta)=> `<label>${label}</label>${ta ? `<textarea id="zf-${k}">${esc(b[k])}</textarea>` : `<input id="zf-${k}" value="${esc(b[k])}">`}`;
    m.innerHTML = `<div class="zr-m">
      <h3>${id ? '✏️ Modifier le bureau' : '+ Nouveau bureau'}</h3>
      <div class="row2"><div>${f('n','N° wilaya')}</div><div>${f('w','Wilaya')}</div><div>${f('wa','الولاية')}</div></div>
      <div class="row2"><div>${f('name','Nom du bureau')}</div><div>${f('nameAr','اسم المكتب')}</div></div>
      ${f('addr','Adresse (français)', true)}
      ${f('addrAr','العنوان (عربي)', true)}
      ${f('desk','Stop desk (séparer par / )')}
      ${f('com','N° commercial')}
      ${f('rec','N° réclamation')}
      <div class="zr-mb">${id ? '<button class="dl" id="zf-del">🗑️</button>' : ''}<button class="cl" id="zf-cancel">Annuler</button><button class="sv" id="zf-save">Enregistrer</button></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e=>{ if(e.target === m) m.remove(); });
    document.getElementById('zf-cancel').onclick = ()=> m.remove();
    const del = document.getElementById('zf-del');
    if(del) del.onclick = async ()=>{
      if(!confirm('Supprimer ce bureau ?')) return;
      const prev = list; list = list.filter(x=>x.id!==id);
      try{ await save(); m.remove(); render(); toast('Bureau supprimé'); }catch(e){ list = prev; toast('Échec — non enregistré', true); }
    };
    document.getElementById('zf-save').onclick = async ()=>{
      const v = {}; KEYS.forEach(k=> v[k] = document.getElementById('zf-'+k).value.trim());
      v.n = parseInt(v.n, 10);
      if(!v.n || v.n < 1 || v.n > 69){ toast('N° de wilaya invalide', true); return; }
      if(!v.name && !v.w){ toast('Donnez un nom au bureau', true); return; }
      if(!v.name) v.name = v.w; if(!v.w) v.w = v.name;
      const prev = list.map(x=>Object.assign({}, x));
      const item = Object.assign({}, b, v);
      list = id ? list.map(x=> x.id===id ? item : x) : list.concat([item]);
      const btn = document.getElementById('zf-save'); btn.disabled = true; btn.textContent = '⏳...';
      try{ await save(); m.remove(); render(); toast('✅ Bureau enregistré'); }
      catch(e){ list = prev; btn.disabled = false; btn.textContent = 'Enregistrer'; toast('Échec — non enregistré', true); }
    };
  }

  window.renderZrPage = async function(){
    render();
    if(!loaded){ await load(); render(); }
  };
})();
