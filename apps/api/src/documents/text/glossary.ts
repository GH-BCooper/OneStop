// Built-in bilingual glossary for the offline Document Translator (07-word-ppt-tools.md).
//
// One row per entry: English | Spanish | French | German | Italian | Portuguese. Multi-word rows
// are phrases, matched before single words. Deliberately small (common words and phrases) — it
// gives a rough, literal, word-by-word translation with no network and no model download. The
// summary says so. Phase 16 can replace the engine with an LLM behind the same tool contract.
export const GLOSSARY_LANGUAGES = ["en", "es", "fr", "de", "it", "pt"] as const;
export type GlossaryLanguage = (typeof GLOSSARY_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<GlossaryLanguage, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
};

export const GLOSSARY = `
thank you very much|muchas gracias|merci beaucoup|vielen Dank|grazie mille|muito obrigado
thank you|gracias|merci|danke|grazie|obrigado
good morning|buenos días|bonjour|guten Morgen|buongiorno|bom dia
good afternoon|buenas tardes|bon après-midi|guten Tag|buon pomeriggio|boa tarde
good evening|buenas noches|bonsoir|guten Abend|buonasera|boa noite
good night|buenas noches|bonne nuit|gute Nacht|buonanotte|boa noite
how are you|cómo estás|comment allez-vous|wie geht es Ihnen|come stai|como está
you're welcome|de nada|de rien|gern geschehen|prego|de nada
excuse me|disculpe|excusez-moi|entschuldigung|mi scusi|com licença
i am|yo soy|je suis|ich bin|io sono|eu sou
i have|yo tengo|j'ai|ich habe|io ho|eu tenho
there is|hay|il y a|es gibt|c'è|há
there are|hay|il y a|es gibt|ci sono|há
of the|del|du|des|del|do
in the|en el|dans le|im|nel|no
on the|en el|sur le|auf dem|sul|no
to the|al|au|zum|al|ao
at the|en el|au|am|al|no
as soon as possible|lo antes posible|dès que possible|so bald wie möglich|il prima possibile|o mais rápido possível
for example|por ejemplo|par exemple|zum Beispiel|per esempio|por exemplo
of course|por supuesto|bien sûr|natürlich|certo|claro
in order to|para|afin de|um zu|per|para
the|el|le|der|il|o
a|un|un|ein|un|um
an|un|un|ein|un|um
and|y|et|und|e|e
or|o|ou|oder|o|ou
but|pero|mais|aber|ma|mas
not|no|pas|nicht|non|não
no|no|non|nein|no|não
yes|sí|oui|ja|sì|sim
is|es|est|ist|è|é
are|son|sont|sind|sono|são
was|era|était|war|era|era
were|eran|étaient|waren|erano|eram
be|ser|être|sein|essere|ser
been|sido|été|gewesen|stato|sido
have|tener|avoir|haben|avere|ter
has|tiene|a|hat|ha|tem
had|tenía|avait|hatte|aveva|tinha
do|hacer|faire|tun|fare|fazer
does|hace|fait|tut|fa|faz
will|será|sera|wird|sarà|será
can|poder|pouvoir|können|potere|poder
could|podría|pourrait|könnte|potrebbe|poderia
should|debería|devrait|sollte|dovrebbe|deveria
must|debe|doit|muss|deve|deve
would|haría|ferait|würde|farebbe|faria
may|puede|peut|darf|può|pode
i|yo|je|ich|io|eu
you|tú|vous|Sie|tu|você
he|él|il|er|lui|ele
she|ella|elle|sie|lei|ela
it|eso|il|es|esso|isso
we|nosotros|nous|wir|noi|nós
they|ellos|ils|sie|loro|eles
me|me|moi|mich|mi|me
my|mi|mon|mein|mio|meu
your|tu|votre|Ihr|tuo|seu
his|su|son|sein|suo|seu
her|su|sa|ihr|suo|dela
our|nuestro|notre|unser|nostro|nosso
their|su|leur|ihr|loro|deles
this|este|ce|dieser|questo|este
that|ese|cela|das|quello|esse
these|estos|ces|diese|questi|estes
those|esos|ceux|jene|quelli|esses
what|qué|quoi|was|che cosa|o que
who|quién|qui|wer|chi|quem
where|dónde|où|wo|dove|onde
when|cuándo|quand|wann|quando|quando
why|por qué|pourquoi|warum|perché|por que
how|cómo|comment|wie|come|como
which|cuál|lequel|welche|quale|qual
all|todo|tout|alle|tutto|todo
some|algunos|quelques|einige|alcuni|alguns
many|muchos|beaucoup|viele|molti|muitos
more|más|plus|mehr|più|mais
most|más|plupart|meisten|più|mais
less|menos|moins|weniger|meno|menos
very|muy|très|sehr|molto|muito
also|también|aussi|auch|anche|também
only|solo|seulement|nur|solo|apenas
other|otro|autre|andere|altro|outro
same|mismo|même|gleich|stesso|mesmo
new|nuevo|nouveau|neu|nuovo|novo
old|viejo|vieux|alt|vecchio|velho
good|bueno|bon|gut|buono|bom
bad|malo|mauvais|schlecht|cattivo|mau
big|grande|grand|groß|grande|grande
small|pequeño|petit|klein|piccolo|pequeno
long|largo|long|lang|lungo|longo
short|corto|court|kurz|corto|curto
high|alto|haut|hoch|alto|alto
low|bajo|bas|niedrig|basso|baixo
important|importante|important|wichtig|importante|importante
different|diferente|différent|anders|diverso|diferente
easy|fácil|facile|einfach|facile|fácil
difficult|difícil|difficile|schwierig|difficile|difícil
first|primero|premier|erste|primo|primeiro
last|último|dernier|letzte|ultimo|último
next|siguiente|suivant|nächste|prossimo|próximo
free|gratis|gratuit|kostenlos|gratuito|grátis
here|aquí|ici|hier|qui|aqui
there|allí|là|dort|lì|lá
now|ahora|maintenant|jetzt|ora|agora
today|hoy|aujourd'hui|heute|oggi|hoje
tomorrow|mañana|demain|morgen|domani|amanhã
yesterday|ayer|hier|gestern|ieri|ontem
always|siempre|toujours|immer|sempre|sempre
never|nunca|jamais|nie|mai|nunca
again|otra vez|encore|wieder|ancora|novamente
with|con|avec|mit|con|com
without|sin|sans|ohne|senza|sem
for|para|pour|für|per|para
from|de|de|von|da|de
to|a|à|zu|a|para
in|en|dans|in|in|em
on|en|sur|auf|su|em
at|en|à|bei|a|em
by|por|par|von|da|por
of|de|de|von|di|de
about|sobre|sur|über|su|sobre
after|después|après|nach|dopo|depois
before|antes|avant|vor|prima|antes
between|entre|entre|zwischen|tra|entre
during|durante|pendant|während|durante|durante
because|porque|parce que|weil|perché|porque
if|si|si|wenn|se|se
then|entonces|alors|dann|allora|então
than|que|que|als|di|do que
so|así que|donc|also|quindi|então
please|por favor|s'il vous plaît|bitte|per favore|por favor
hello|hola|bonjour|hallo|ciao|olá
goodbye|adiós|au revoir|auf Wiedersehen|arrivederci|adeus
sorry|lo siento|désolé|Entschuldigung|scusa|desculpe
man|hombre|homme|Mann|uomo|homem
woman|mujer|femme|Frau|donna|mulher
people|gente|gens|Leute|persone|pessoas
person|persona|personne|Person|persona|pessoa
child|niño|enfant|Kind|bambino|criança
children|niños|enfants|Kinder|bambini|crianças
family|familia|famille|Familie|famiglia|família
friend|amigo|ami|Freund|amico|amigo
friends|amigos|amis|Freunde|amici|amigos
house|casa|maison|Haus|casa|casa
home|hogar|maison|Zuhause|casa|casa
city|ciudad|ville|Stadt|città|cidade
country|país|pays|Land|paese|país
world|mundo|monde|Welt|mondo|mundo
time|tiempo|temps|Zeit|tempo|tempo
day|día|jour|Tag|giorno|dia
days|días|jours|Tage|giorni|dias
week|semana|semaine|Woche|settimana|semana
month|mes|mois|Monat|mese|mês
year|año|année|Jahr|anno|ano
years|años|ans|Jahre|anni|anos
hour|hora|heure|Stunde|ora|hora
morning|mañana|matin|Morgen|mattina|manhã
night|noche|nuit|Nacht|notte|noite
water|agua|eau|Wasser|acqua|água
food|comida|nourriture|Essen|cibo|comida
money|dinero|argent|Geld|soldi|dinheiro
work|trabajo|travail|Arbeit|lavoro|trabalho
job|trabajo|emploi|Job|lavoro|emprego
school|escuela|école|Schule|scuola|escola
book|libro|livre|Buch|libro|livro
document|documento|document|Dokument|documento|documento
documents|documentos|documents|Dokumente|documenti|documentos
file|archivo|fichier|Datei|file|arquivo
files|archivos|fichiers|Dateien|file|arquivos
page|página|page|Seite|pagina|página
pages|páginas|pages|Seiten|pagine|páginas
text|texto|texte|Text|testo|texto
word|palabra|mot|Wort|parola|palavra
words|palabras|mots|Wörter|parole|palavras
language|idioma|langue|Sprache|lingua|idioma
name|nombre|nom|Name|nome|nome
number|número|nombre|Nummer|numero|número
question|pregunta|question|Frage|domanda|pergunta
answer|respuesta|réponse|Antwort|risposta|resposta
problem|problema|problème|Problem|problema|problema
information|información|information|Information|informazione|informação
report|informe|rapport|Bericht|rapporto|relatório
meeting|reunión|réunion|Besprechung|riunione|reunião
project|proyecto|projet|Projekt|progetto|projeto
company|empresa|entreprise|Firma|azienda|empresa
team|equipo|équipe|Team|squadra|equipe
customer|cliente|client|Kunde|cliente|cliente
price|precio|prix|Preis|prezzo|preço
order|pedido|commande|Bestellung|ordine|pedido
email|correo|e-mail|E-Mail|email|e-mail
phone|teléfono|téléphone|Telefon|telefono|telefone
computer|ordenador|ordinateur|Computer|computer|computador
data|datos|données|Daten|dati|dados
list|lista|liste|Liste|elenco|lista
table|tabla|tableau|Tabelle|tabella|tabela
image|imagen|image|Bild|immagine|imagem
picture|imagen|image|Bild|immagine|imagem
example|ejemplo|exemple|Beispiel|esempio|exemplo
part|parte|partie|Teil|parte|parte
way|manera|façon|Weg|modo|maneira
thing|cosa|chose|Ding|cosa|coisa
things|cosas|choses|Dinge|cose|coisas
life|vida|vie|Leben|vita|vida
love|amor|amour|Liebe|amore|amor
help|ayuda|aide|Hilfe|aiuto|ajuda
go|ir|aller|gehen|andare|ir
come|venir|venir|kommen|venire|vir
see|ver|voir|sehen|vedere|ver
know|saber|savoir|wissen|sapere|saber
think|pensar|penser|denken|pensare|pensar
want|querer|vouloir|wollen|volere|querer
need|necesitar|avoir besoin|brauchen|avere bisogno|precisar
make|hacer|faire|machen|fare|fazer
take|tomar|prendre|nehmen|prendere|pegar
give|dar|donner|geben|dare|dar
get|obtener|obtenir|bekommen|ottenere|obter
find|encontrar|trouver|finden|trovare|encontrar
tell|decir|dire|sagen|dire|dizer
say|decir|dire|sagen|dire|dizer
ask|preguntar|demander|fragen|chiedere|perguntar
use|usar|utiliser|benutzen|usare|usar
write|escribir|écrire|schreiben|scrivere|escrever
read|leer|lire|lesen|leggere|ler
speak|hablar|parler|sprechen|parlare|falar
send|enviar|envoyer|senden|inviare|enviar
open|abrir|ouvrir|öffnen|aprire|abrir
close|cerrar|fermer|schließen|chiudere|fechar
start|empezar|commencer|beginnen|iniziare|começar
finish|terminar|finir|beenden|finire|terminar
buy|comprar|acheter|kaufen|comprare|comprar
pay|pagar|payer|bezahlen|pagare|pagar
live|vivir|vivre|leben|vivere|viver
learn|aprender|apprendre|lernen|imparare|aprender
understand|entender|comprendre|verstehen|capire|entender
like|gustar|aimer|mögen|piacere|gostar
please note|tenga en cuenta|veuillez noter|bitte beachten|si prega di notare|observe
one|uno|un|eins|uno|um
two|dos|deux|zwei|due|dois
three|tres|trois|drei|tre|três
four|cuatro|quatre|vier|quattro|quatro
five|cinco|cinq|fünf|cinque|cinco
ten|diez|dix|zehn|dieci|dez
hundred|cien|cent|hundert|cento|cem
`;
